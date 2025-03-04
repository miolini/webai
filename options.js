function saveOptions() {
    const llmEndpoint = document.getElementById('llmEndpoint').value;
    const speechEndpoint = document.getElementById('speechEndpoint').value;

    chrome.storage.sync.set({
        llmEndpoint: llmEndpoint,
        speechEndpoint: speechEndpoint
    }, () => {
        const status = document.getElementById('status');
        status.style.display = "block";
        setTimeout(() => {
            status.style.display = "none";
        }, 1500);
    });
}

function restoreOptions() {
    chrome.storage.sync.get({
        llmEndpoint: 'http://localhost:11434', // Default LLM endpoint
        speechEndpoint: 'http://localhost:8880' // Default speech endpoint
    }, (items) => {
        document.getElementById('llmEndpoint').value = items.llmEndpoint;
        document.getElementById('speechEndpoint').value = items.speechEndpoint;
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveOptions').addEventListener('click', saveOptions);
