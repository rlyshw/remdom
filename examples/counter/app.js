// Counter app — runs server-side in the remote-dom isolate
// `document` and `window` are provided by the host

var count = 0;
var countEl = document.getElementById("count");
var incBtn = document.getElementById("inc-btn");
var decBtn = document.getElementById("dec-btn");
var resetBtn = document.getElementById("reset-btn");

function updateDisplay() {
  if (countEl) {
    countEl.textContent = String(count);
  }
}

if (incBtn) {
  incBtn.addEventListener("click", function () {
    count++;
    updateDisplay();
  });
}

if (decBtn) {
  decBtn.addEventListener("click", function () {
    count--;
    updateDisplay();
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", function () {
    count = 0;
    updateDisplay();
  });
}
