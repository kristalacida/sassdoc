'use strict';

var path = require('path');
var cp = require('child_process');
var Q = require('q');
var which = Q.denodeify(require('which'));
var rmdir = Q.denodeify(require('rimraf'));

/**
 * Execute a child process command.
 *
 * @see    {@link http://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback}
 * @param  {String} command
 * @param  {Object} options
 * @return {Q.Promise}
 */
function exec(command) {
  var args = Array.prototype.slice.call(arguments);
  var deferred = Q.defer();
  var childProcess;

  args.push(function (err, stdout, stderr) {
    if (err) {
      err.message += command + ' (exited with error code ' + err.code + ')';
      err.stdout = stdout;
      err.stderr = stderr;
      deferred.reject(err);
    }
    else {
      deferred.resolve({
        childProcess: childProcess,
        stdout: stdout,
        stderr: stderr
      });
    }
  });

  childProcess = cp.exec.apply(cp, args);
  process.nextTick(function () {
    deferred.notify(childProcess);
  });

  return deferred.promise;
}

/**
 * SassDoc converter constructor.
 */
function Converter(api) {
  this.tmpDir = path.join(process.cwd(), '.tmp');
  this.src = '';
  this.useBundler = false;
  this.api = api;
}

/**
 * Check whether passed binary (Gem) is in $PATH.
 *
 * @param  {String} bin
 * @return {Q.Promise}
 */
Converter.prototype.checkBinary = function (bin) {
  var self = this;

  return which(bin)
    .then(null, function () {
      return which('bundle')
        .then(function () {
          self.useBundler = true;
          // `bundle show bin` was more adapted but
          // `sassdoc-convert` is not a gem.
          var command = 'bundle exec ' + bin + ' -v';
          return exec(command);
        });
    })
    .catch(function (err) {
      err.message = 'SassDoc could not find any executable for `' +
                    bin + '`. Operation Aborted.';
      throw err;
    });
};

/**
 * Format the `sass-convert` command string.
 *
 * @return {String}
 */
Converter.prototype.command = function () {
  var command = [
    'sass-convert',
    '-R',
    '--from=sass',
    '--to=scss',
    this.src,
    this.tmpDir
  ];

  if (this.useBundler) {
    command.unshift('bundle exec');
  }

  return command.join(' ');
};

/**
 * Perform a Sass to SCSS syntax convertion.
 *
 * @return {Q.Promise}
 */
Converter.prototype.convert = function () {
  var self = this;

  return self.checkBinary('sass-convert')
    .then(function () {
      return rmdir(self.tmpDir);
    })
    .then(function () {
      self.api.logger.log(
        'Converting folder `' + self.src + '` into SCSS syntax.'
      );
      return exec(self.command());
    })
    .then(function () {
      self.api.logger.log(
        'Folder `' + self.src + '` successfully converted from Sass to SCSS.'
      );
    });
};

/**
 * Perform a sass to scss syntax convertion
 * and run SassDoc against the resulting files.
 *
 * @param  {String} src
 * @param  {String} dest
 * @param  {Object} config
 * @return {Q.Promise}
 */
Converter.prototype.documentize = function (src, dest, config) {
  var self = this;
  self.src = src;

  return self.convert()
    .then(function () {
      return self.api.documentize(self.tmpDir, dest, config);
    })
    .then(function () {
      return rmdir(self.tmpDir);
    })
    .catch(function (err) {
      self.api.logger.enabled = true;
      self.api.logger.error(err);
    });
};

module.exports = function (sassdoc) {
  sassdoc = sassdoc || require('./api');

  return new Converter(sassdoc);
};
