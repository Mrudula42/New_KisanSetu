window.kisanSetuApiUrl = function (path) {
  return new URL(path, 'http://localhost:3000').toString();
};
