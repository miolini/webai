// filepath: /Users/mio/work/webai/initPdfWorker.js
// Ensure pdfjsLib is loaded before setting the worker source
if (typeof pdfjsLib !== 'undefined') {
  // Use chrome.runtime.getURL to get the correct path within the extension
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.js');
  console.log('PDF.js worker source set to:', pdfjsLib.GlobalWorkerOptions.workerSrc);
} else {
  // console.error('Error: pdfjsLib is not defined when initPdfWorker.js runs. PDF worker source NOT set.');
  // Attempt to set it when the DOM is fully loaded as a fallback
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof pdfjsLib !== 'undefined') {
       pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.js');
       console.log('PDF.js worker source set via DOMContentLoaded.');
    } else {
      //  console.error('Error: pdfjsLib still not defined on DOMContentLoaded. PDF functionality will likely fail.');
       // You might want to display an error to the user here
       const statusDiv = document.getElementById('status');
       if (statusDiv) {
           statusDiv.innerText = 'Error: Failed to initialize PDF library.';
           statusDiv.style.display = 'block';
       }
    }
  });
}