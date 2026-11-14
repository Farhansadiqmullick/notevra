// Desktop Google sign-in lands here, then hands the one-time code to the app; the code is useless without the app's verifier.
(function () {
  var params = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1));
  var forward = new URLSearchParams();
  ['code', 'error', 'error_description'].forEach(function (k) {
    if (params.get(k)) forward.set(k, params.get(k));
  });
  var link = 'notevra://auth/callback?' + forward.toString();
  document.getElementById('open').href = link;

  if (params.get('error') || params.get('error_description')) {
    document.getElementById('card').className = 'card bad';
    document.getElementById('title').textContent = 'Sign-in didn’t finish';
    document.getElementById('body').textContent =
      (params.get('error_description') || params.get('error')) + '. You can close this tab and try again in Notevra.';
  } else if (!params.get('code')) {
    document.getElementById('title').textContent = 'Nothing to do here';
    document.getElementById('body').textContent = 'This page finishes a sign-in started in the Notevra desktop app.';
    document.getElementById('open').hidden = true;
    return;
  }

  // keep the code out of the browser history
  window.history.replaceState(null, '', window.location.pathname);
  window.location.href = link;
})();
