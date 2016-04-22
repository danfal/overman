/*
 * Copyright 2014 Per Eckerdal
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/**
 * Test suite that verifies that reporters get the messages they're supposed to
 * get.
 */

var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var expect = require('chai').expect;
var path = require('path');
var OnMessage = require('./util/on_message');
var shouldFail = require('./util/should_fail');
var makeFakeClock = require('./util/fake_clock');
var TestFailureError = require('../lib/test_failure_error');
var suiteRunner = require('../lib/suite_runner');

function pathForSuite(suite) {
  return path.resolve(__dirname + '/suite/' + suite);
}

function runTestSuite(suite, reporter, options) {
  return suiteRunner(_.extend({
      files: [pathForSuite(suite)],
      timeout: 500,
      reporters: reporter ? [reporter] : []
    }, options));
}

/**
 * Runs the given test suite and listens to the messages from the run.
 *
 * Returns a promise that succeeds if there was a message that matched
 * each predicate, in order. It succeeds even if the test itself fails,
 * and also if there are non-matching messages in between the matching
 * ones.
 */
function ensureMessages(suite, predicates, options) {
  return new Promise(function(resolve, reject) {
    var failed = false;

    var reporter = new OnMessage(function(testPath, message) {
      var success = false;
      try {
        if (predicates.length !== 0) {
          predicates[0](testPath, message);
          predicates.shift();
        }
      } catch (error) {
        if ((options || {}).requireAll) {
          if (!failed) {
            failed = true;
            reject(error);
          }
        }
      }
      if (success) {
        predicates.shift();
      }
    });

    function finish() {
      if (failed) {
        return;
      }

      if (predicates.length === 0) {
        resolve();
      } else {
        reject(new Error('Did not get expected message (' + predicates.length + ' remaining)'));
      }
    }

    runTestSuite(suite, reporter, options).then(finish, finish);
  });
}

function ensureAllMessages(suite, predicate, options) {
  return new Promise(function(resolve, reject) {
    var done = false;

    var reporter = new OnMessage(function(testPath, message) {
      if (!done && !predicate.apply(predicate, arguments)) {
        done = true;
        reject(new Error('Encountered unexpected message from skipped test: ' + message.type));
      }
    });

    function finish(error) {
      if (!done) {
        done = true;

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    }

    var suitePromise = runTestSuite(suite, reporter, options);

    if ((options || {}).shouldFail) {
      suitePromise = shouldFail(suitePromise);
    }

    suitePromise.then(finish, finish);
  });
}

describe('Reporter API', function() {
  it('should invoke registerTests with a list of the tests about to be run', function() {
    var deferred = Promise.defer();

    var testSuitePromise = runTestSuite('suite_single_successful_test', {
      registerTests: function(tests) {
        expect(tests).to.be.deep.equal([{
          file: pathForSuite('suite_single_successful_test'),
          path: [ 'should succeed' ]
        }]);
        deferred.resolve();
      }
    });
    return Promise.all([testSuitePromise, deferred.promise]);
  });

  it('should invoke registerTests with suite runner options', function() {
    var deferred = Promise.defer();

    var options = {
      timeout: 1234,  // Timeout needs to be adequately long
      listingTimeout: 234,
      slowThreshold: 345,
      graceTime: 456,
      attempts: 567
    };

    var testSuitePromise = runTestSuite('suite_single_successful_test', {
      registerTests: function(tests, options) {
        expect(options).to.be.deep.equal(options);
        deferred.resolve();
      }
    }, options);
    return Promise.all([testSuitePromise, deferred.promise]);
  });

  it('should invoke registerTests with default suite runner options', function() {
    var deferred = Promise.defer();

    var testSuitePromise = runTestSuite('suite_single_successful_test', {
      registerTests: function(tests, options) {
        expect(options).property('timeout').to.be.a('number');
        expect(options).property('listingTimeout').to.be.a('number');
        expect(options).property('slowThreshold').to.be.a('number');
        expect(options).property('graceTime').to.be.a('number');
        expect(options).property('attempts').to.be.a('number');
        deferred.resolve();
      }
    });
    return Promise.all([testSuitePromise, deferred.promise]);
  });

  it('should invoke registerTests with wall time by default', function() {
    var deferred = Promise.defer();

    var testSuitePromise = runTestSuite('suite_single_successful_test', {
      registerTests: function(tests, options, time) {
        expect(time.getTime() - (new Date()).getTime()).to.be.within(-150, 150);
        deferred.resolve();
      }
    });
    return Promise.all([testSuitePromise, deferred.promise]);
  });

  it('should invoke registerTests with current time', function() {
    var clock = makeFakeClock();
    var deferred = Promise.defer();

    var testSuitePromise = runTestSuite('suite_single_successful_test', {
      registerTests: function(tests, options, time) {
        expect(time).to.be.deep.equal(clock());
        deferred.resolve();
      }
    }, { clock: clock });
    return Promise.all([testSuitePromise, deferred.promise]);
  });

  it('should emit messages with current time', function() {
    var clock = makeFakeClock();

    return ensureAllMessages('suite_various_tests', function(testPath, message, time) {
      expect(time).to.be.deep.equal(clock());
      clock.step(1);
      return true;
    }, { clock: clock, shouldFail: true });
  });

  it('should emit start message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('start');
    }]);
  });

  it('should emit stdout message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('stdout');
      expect(message).property('data').to.exist;
    }]);
  });

  it('should emit stderr message', function() {
    return ensureMessages('suite_single_successful_test_stderr', [function(testPath, message) {
      expect(message).property('type').to.be.equal('stderr');
      expect(message).property('data').to.exist;
    }]);
  });

  it('should emit startedBeforeHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('startedBeforeHooks');
    }]);
  });

  it('should emit startedBeforeHook message', function() {
    return ensureMessages('suite_test_with_named_before_hook', [function(testPath, message) {
      expect(message).property('type').to.be.equal('startedBeforeHook');
      expect(message).property('name').to.be.equal('beforeHookName');
    }]);
  });

  it('should emit startedTest message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('startedTest');
    }]);
  });

  it('should emit startedAfterHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('startedAfterHooks');
    }]);
  });

  it('should emit startedAfterHook message', function() {
    return ensureMessages('suite_test_with_named_after_hook', [function(testPath, message) {
      expect(message).property('type').to.be.equal('startedAfterHook');
      expect(message).property('name').to.be.equal('afterHookName');
    }]);
  });

  it('should emit finishedAfterHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('finishedAfterHooks');
    }]);
  });

  it('should not emit finishedAfterHooks message when after hook never finishes', function() {
    return ensureAllMessages('suite_after_hook_that_never_finishes', function(testPath, message) {
      return message.type !== 'finishedAfterHooks';
    }, { shouldFail: true });
  });

  it('should emit finish message for successful test', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('finish');
      expect(message).property('result').to.be.equal('success');
      expect(message).property('code').to.be.equal(0);
    }]);
  });

  it('should emit finish message for successful test when attempts > 1', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('finish');
      expect(message).property('result').to.be.equal('success');
      expect(message).property('code').to.be.equal(0);
    }], { attempts: 2 });
  });

  it('should emit finish message for failing test', function() {
    return ensureMessages('suite_single_throwing_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('finish');
      expect(message).property('result').to.be.equal('failure');
      expect(message).property('code').to.be.equal(1);
    }]);
  });

  it('should emit start message with skipped marker for skipped test', function() {
    return ensureMessages('suite_single_skipped_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('start');
      expect(message).property('skipped').to.be.equal(true);
    }]);
  });

  it('should emit finish message for skipped test', function() {
    return ensureMessages('suite_single_skipped_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('finish');
      expect(message).property('result').to.be.equal('skipped');
    }]);
  });

  describe('Timeouts', function() {
    it('should emit timeout message for test that times out', function() {
      return ensureMessages('suite_single_test_that_never_finishes', [function(testPath, message) {
        expect(message).property('type').to.be.equal('timeout');
      }]);
    });

    it('should emit finish message for test that times out', function() {
      return ensureMessages('suite_single_test_that_never_finishes', [function(testPath, message) {
        expect(message).property('type').to.be.equal('finish');
        expect(message).property('result').to.be.equal('timeout');
      }]);
    });

    it('should emit reporter messages even after the test times out', function() {
      return ensureMessages('suite_single_test_that_never_finishes_with_after_hook', [function(testPath, message) {
        expect(message).property('type').to.be.equal('debugInfo');
        expect(message).property('name').to.be.equal('in');
        expect(message).property('value').to.be.equal('afterHook');
      }]);
    });

    it('should emit messages in the right order when test times out', function() {
      return ensureMessages('suite_single_test_that_never_finishes_with_after_hook', [function(testPath, message) {
        expect(message).property('type').to.be.equal('timeout');
      }, function(testPath, message) {
        expect(message).property('type').to.be.equal('debugInfo');
      }, function(testPath, message) {
        expect(message).property('type').to.be.equal('finish');
      }]);
    });
  });

  it('should emit only start and finish message for skipped test', function() {
    return ensureAllMessages('suite_single_skipped_test', function(testPath, message) {
      return message.type === 'start' || message.type === 'finish';
    });
  });

  it('should emit finish message last, even when messages arrive after process exit', function() {
    function fork() {
      var child = new EventEmitter();
      child.stdout = { on: function() {} };
      child.stderr = { on: function() {} };

      process.nextTick(function() {
        child.emit('exit', 0, null);
        child.emit('message', { type: 'testMessage' });
        child.emit('close');
      });

      return child;
    }

    return ensureMessages('suite_single_test_that_never_finishes', [
      function(testPath, message) { expect(message).property('type').to.be.equal('start'); },
      function(testPath, message) { expect(message).property('type').to.be.equal('testMessage'); },
      function(testPath, message) { expect(message).property('type').to.be.equal('finish'); }
    ], {
      childProcess: { fork: fork }
    });
  });

  it('should emit retry message when a test is retried', function() {
    var messages = [
      'start',
      'startedBeforeHooks',
      'startedTest',
      'breadcrumb',
      'error',
      'startedAfterHooks',
      'breadcrumb',
      'finishedAfterHooks',
      'retry',
      'startedBeforeHooks',
      'startedTest',
      'breadcrumb',
      'error',
      'startedAfterHooks',
      'breadcrumb',
      'finishedAfterHooks',
      'finish',
    ];

    return ensureMessages(
      'suite_single_failing_test',
      messages.map(function(type) {
        return function(testPath, message) { expect(message).property('type').to.be.equal(type); };
      }),
      {
        attempts: 2,
        requireAll: true
      });
  });

  it('should emit messages with a correct test path', function() {
    var suite = 'suite_single_skipped_test';
    return ensureAllMessages(suite, function(testPath) {
      return testPath.file === pathForSuite(suite);
    });
  });

  it('should emit error message when before hook fails', function() {
    return ensureMessages('suite_failing_before_hook', [function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('beforeHook');
      expect(message).property('inName').to.be.equal('before hook');
    }]);
  });

  it('should emit error message when test fails', function() {
    return ensureMessages('suite_single_throwing_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('test');
    }]);
  });

  it('should emit error message when test fails with an uncaught exception', function() {
    return ensureMessages('suite_single_test_uncaught_exception', [function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('uncaught');
    }]);
  });

  it('should emit error message when after hook fails', function() {
    return ensureMessages('suite_failing_after_hook', [function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('afterHook');
      expect(message).property('inName').to.be.equal('after hook');
    }]);
  });

  it('should report errors from both the test and after hook when both fail', function() {
    return ensureMessages('suite_failing_after_hook_and_failing_test', [function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('test');
    }, function(testPath, message) {
      expect(message).property('type').to.be.equal('error');
      expect(message).property('in').to.be.equal('afterHook');
      expect(message).property('inName').to.be.equal('after hook');
    }]);
  });

  it('should report syntax errors', function() {
    var deferred = Promise.defer();

    var testSuitePromise = runTestSuite('suite_syntax_error', {
      registrationFailed: function(error) {
        expect(error).property('message').to.match(/Failed to process .*suite_syntax_error/);
        expect(error).property('stack').to.match(/SyntaxError: Unexpected identifier/);
        deferred.resolve();
      }
    });

    return Promise.all([
      shouldFail(testSuitePromise, function(err) {
        return err instanceof TestFailureError;
      }),
      deferred.promise
    ]);
  });

  it('should emit an aborted finish message when suite is cancelled while the test is running', function() {
    var deferred = Promise.defer();
    var suitePromise = runTestSuite('suite_single_successful_test', new OnMessage(function(testPath, message) {
      if (message.type === 'start') {
        suitePromise.cancel();
      } else if (message.type === 'finish') {
        expect(message).property('result').to.be.equal('aborted');
        deferred.resolve();
      }
    }));

    return Promise.all([
      shouldFail(suitePromise, function(err) {
        return err instanceof TestFailureError;
      }),
      deferred.promise
    ]);
  });

  it('should not emit any start messages after the suite has been cancelled', function() {
    var cancelled = false;
    var deferred = Promise.defer();
    var suitePromise = runTestSuite('suite_various_tests', new OnMessage(function(testPath, message) {
      if (message.type === 'start') {
        if (cancelled) {
          deferred.reject(new Error('Got start message after cancellation'));
        } else {
          suitePromise.cancel();
          cancelled = true;
        }
      }
    }));

    return Promise.race([
      shouldFail(suitePromise),
      deferred.promise
    ]);
  });

  it('should emit a done message after a suite has been cancelled', function() {
    var deferred = Promise.defer();
    var suitePromise = runTestSuite('suite_single_successful_test', {
      gotMessage: function(testPath, message) {
        if (message.type === 'start') {
          suitePromise.cancel();
        }
      },
      done: function() {
        deferred.resolve();
      }
    });

    return Promise.all([
      shouldFail(suitePromise, function(error) {
        return error instanceof TestFailureError;
      }),
      deferred.promise
    ]);
  });

  it('should emit done messages with the current time as parameter', function() {
    var deferred = Promise.defer();
    var clock = makeFakeClock();
    var suitePromise = runTestSuite('suite_single_successful_test', {
      gotMessage: function() {
        clock.step(1);  // Step the clock just to be sure that we don't get a stale timestamp
      },
      done: function(time) {
        expect(time).to.be.deep.equal(clock());
        deferred.resolve();
      }
    }, { clock: clock });

    return Promise.all([
      suitePromise,
      deferred.promise
    ]);
  });

  it('should gracefully handle when the interface takes forever', function() {
    return shouldFail(runTestSuite('suite_neverending_listing', [], { listingTimeout: 1000 }), function(error) {
      return (error instanceof TestFailureError) &&
        error.message.match(/Timed out while listing tests of .*suite_neverending_listing/);
    });
  });

  describe('breadcrumb handling', function() {
    it('should emit breadcrumb messages when the test leaves a breadcrumb', function() {
      return ensureMessages('suite_leave_breadcrumb', [function(testPath, message) {
        expect(message).property('type').to.be.equal('breadcrumb');
        expect(message).property('message').to.be.equal('A breadcrumb');
        expect(message).property('trace').to.be.contain('suite_leave_breadcrumb.js:');
      }]);
    });

    it('should emit breadcrumb message before the test is run', function() {
      return ensureMessages('suite_single_successful_test', [function(testPath, message) {
        expect(message).to.be.deep.equal({
          type: 'breadcrumb',
          message: 'Starting test',
          systemGenerated: true
        });
      }]);
    });

    it('should emit breadcrumb message after the after hooks are done', function() {
      return ensureMessages('suite_single_successful_test', [function(testPath, message) {
        expect(message).to.be.deep.equal({
          type: 'breadcrumb',
          message: 'Finished running after hooks',
          systemGenerated: true
        });
      }]);
    });

    ['before', 'after'].forEach(function(type) {
      it('should emit breadcrumb message before ' + type + ' hooks are run', function() {
        return ensureMessages('suite_' + type + '_hook_and_test', [function(testPath, message) {
          expect(message).to.be.deep.equal({
            type: 'breadcrumb',
            message: 'Starting ' + type + ' hook',
            systemGenerated: true
          });
        }]);
      });

      it('should emit breadcrumb message before named ' + type + ' hooks are run', function() {
        return ensureMessages('suite_test_with_named_' + type + '_hook', [function(testPath, message) {
          expect(message).to.be.deep.equal({
            type: 'breadcrumb',
            message: 'Starting ' + type + ' hook "' + type + 'HookName"',
            systemGenerated: true
          });
        }]);
      });
    });
  });

  describe('debugInfo handling', function() {
    it('should emit debugInfo messages when the test emits debug info', function() {
      return ensureMessages('suite_emit_debug_info', [function(testPath, message) {
        expect(message).property('type').to.be.equal('debugInfo');
        expect(message).property('name').to.be.equal('name');
        expect(message).property('value').to.be.deep.equal({ the: 'value' });
      }]);
    });
  });
});
