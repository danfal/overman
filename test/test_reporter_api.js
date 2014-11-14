'use strict';

/**
 * Test suite that verifies that reporters get the messages they're supposed to
 * get.
 */

var path = require('path');
var when = require('when');
var OnMessage = require('./util/on_message');
var suiteRunner = require('../lib/suite_runner');

function runTestSuite(suite, reporter) {
  return suiteRunner({
      suites: [__dirname + '/suite/' + suite],
      interface: __dirname + '/../lib/interface/bdd_mocha',
      timeout: 500,
      reporters: [reporter]
    });
}

/**
 * Runs the given test suite and listens to the messages from the run.
 *
 * Returns a promise that succeeds if there was a message that matched
 * each predicate, in order. It succeeds even if the test itself fails,
 * and also if there are non-matching messages in between the matching
 * ones.
 */
function ensureMessages(suite, predicates) {
  return when.promise(function(resolve, reject) {
    var reporter = new OnMessage(function(testPath, message) {
      if (predicates.length !== 0 && predicates[0](testPath, message)) {
        predicates.shift();
      }
    });

    function finish() {
      if (predicates.length === 0) {
        resolve();
      } else {
        reject(new Error('Did not get expected message (' + predicates.length + ' remaining)'));
      }
    }

    runTestSuite(suite, reporter).done(finish, finish);
  });
}

function ensureAllMessages(suite, predicate) {
  return when.promise(function(resolve, reject) {
    var done = false;

    var reporter = new OnMessage(function(testPath, message) {
      if (!done && !predicate(testPath, message)) {
        done = true;
        reject(new Error('Encountered unexpected message from skipped test: ' + message.type));
      }
    });

    function finish() {
      if (!done) {
        done = true;
        resolve();
      }
    }

    runTestSuite(suite, reporter).done(finish, finish);
  });
}

describe('Reporter API', function() {
  it('should emit begin message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return message.type === 'begin';
    }]);
  });

  it('should emit stdio message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return (message.type === 'stdio' &&
              message.stdin &&
              message.stdout &&
              message.stderr);
    }]);
  });

  it('should emit startedBeforeHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return message.type === 'startedBeforeHooks';
    }]);
  });

  it('should emit startedBeforeHook message', function() {
    return ensureMessages('suite_test_with_named_before_hook', [function(testPath, message) {
      return (message.type === 'startedBeforeHook' &&
              message.name === 'beforeHookName');
    }]);
  });

  it('should emit startedTest message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return message.type === 'startedTest';
    }]);
  });

  it('should emit startedAfterHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return message.type === 'startedAfterHooks';
    }]);
  });

  it('should emit startedAfterHook message', function() {
    return ensureMessages('suite_test_with_named_after_hook', [function(testPath, message) {
      return (message.type === 'startedAfterHook' &&
              message.name === 'afterHookName');
    }]);
  });

  it('should emit finishedAfterHooks message', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return message.type === 'finishedAfterHooks';
    }]);
  });

  it('should not emit finishedAfterHooks message when after hook never finishes', function() {
    return ensureAllMessages('suite_after_hook_that_never_finishes', function(testPath, message) {
      return message.type !== 'finishedAfterHooks';
    });
  });

  it('should emit finish message for successful test', function() {
    return ensureMessages('suite_single_successful_test', [function(testPath, message) {
      return (message.type === 'finish' &&
              message.result === 'success' &&
              message.code === 0);
    }]);
  });

  it('should emit finish message for failing test', function() {
    return ensureMessages('suite_single_throwing_test', [function(testPath, message) {
      return (message.type === 'finish' &&
              message.result === 'failure' &&
              message.code === 1);
    }]);
  });

  it('should emit finish message for skipped test', function() {
    return ensureMessages('suite_single_skipped_test', [function(testPath, message) {
      return (message.type === 'finish' &&
              message.result === 'skipped');
    }]);
  });

  it('should emit finish message for test that times out', function() {
    return ensureMessages('suite_single_test_that_never_finishes', [function(testPath, message) {
      return (message.type === 'finish' &&
              message.result === 'timeout');
    }]);
  });

  it('should emit only begin and finish message for skipped test', function() {
    return ensureAllMessages('suite_single_skipped_test', function(testPath, message) {
      return message.type === 'begin' || message.type === 'finish';
    });
  });

  it('should emit messages with a correct test path', function() {
    var suite = 'suite_single_skipped_test';
    return ensureAllMessages(suite, function(testPath, message) {
      return (testPath.file === path.resolve(__dirname + '/suite/' + suite));
    });
  });

  it('should emit error message when before hook fails', function() {
    return ensureMessages('suite_failing_before_hook', [function(testPath, message) {
      return (message.type === 'error' &&
              message.in === 'beforeHook',
              message.inName === 'before hook');
    }]);
  });

  it('should emit error message when test fails', function() {
    return ensureMessages('suite_single_throwing_test', [function(testPath, message) {
      return (message.type === 'error' &&
              message.in === 'test');
    }]);
  });

  it('should emit error message when after hook fails', function() {
    return ensureMessages('suite_failing_after_hook', [function(testPath, message) {
      return (message.type === 'error' &&
              message.in === 'afterHook',
              message.inName === 'after hook');
    }]);
  });

  it('should report errors from both the test and after hook when both fail', function() {
    return ensureMessages('suite_failing_after_hook_and_failing_test', [function(testPath, message) {
      return (message.type === 'error' &&
              message.in === 'test');
    }, function(testPath, message) {
      return (message.type === 'error' &&
              message.in === 'afterHook',
              message.inName === 'after hook');
    }]);
  });

  it('should report syntax errors');
  it('should gracefully handle when the interface takes forever');
  it('should report error for failing before hook');
  it('should report error for failing test');
  it('should report error for failing after hook');
});
