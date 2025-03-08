var optionModel = "";

// Function to get the stored endpoints
function getEndpoints() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            llmEndpoint: 'http://localhost:11434', // Default LLM endpoint
            speechEndpoint: 'http://localhost:8880' // Default speech endpoint
        }, (items) => {
            resolve(items);
        });
    });
}


document.getElementById('summarize-button').addEventListener('click', async () => {
    // Get active tab URL
    console.log('Button clicked');
    document.getElementById('status').style.display = 'block';
    document.getElementById('summary').innerText = ''; 

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Execute script in the context of the current page
    chrome.scripting.executeScript({
        target: {tabId: tab.id},
        function: getCurrentPageContent,
    }, async (results) =>{
        if (chrome.runtime.lastError) {
            console.error(JSON.stringify(chrome.runtime.lastError));
            document.getElementById('status').style.display = 'none';
            document.getElementById('summary').innerText = 'An error occurred while fetching the page content.';
            return;
        }

        const content = results[0].result;
        const model = document.getElementById('model-select').value;

        // Save the selected model to Chrome storage as key model
        chrome.storage.sync.set({model: model}, function() {
            console.log('Model saved:',
                JSON.stringify({model: model}));
        });  
        const endpoints = await getEndpoints();
        // Send the content to OpenAI API
        fetch(endpoints.llmEndpoint+"/api/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                system: 'You are have a role to summarize web pages that user browsing. Do not user any formatting. Summarize the following user browsing content to a bullet list of key 5-7 takeaways. Also write paragraph about surprizing and novel things in the content. Always respond in English.',
                prompt: content,
                stream: false,
                options: {
                    temperature: 0.2,
                    num_ctx: 16384
                }
            })
        }).then(response => response.json())
          .then(data => {
              response = data.response;
              // remove <think>...</think> tags and in between (multiline)
                response = response.replace(/<think>(.|\n)*?<\/think>/g, '');
                // trim
                response = response.trim();

              document.getElementById('status').style.display = 'none';
              document.getElementById('summary').innerText = response;
          })
          .catch(error => {
            console.error('Error:', error)
            document.getElementById('status').style.display = 'none';
            document.getElementById('summary').innerText = 'An error occurred while summarizing the page content.';
          
        });
    });
});

document.getElementById('speakit').addEventListener('click', async () => {
    // contnet from summary id
    const content = document.getElementById('summary').innerText;
    const filename = 'speech.mp3';
    const endpoints = await getEndpoints();
    fetch(endpoints.speechEndpoint+'/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'kokoro',
            voice: 'af_sky',
            speed: 1.0,
            input: content
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Check for Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
         // Default filename

        if (contentDisposition && contentDisposition.indexOf('attachment')  -1) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(contentDisposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, ''); // Remove quotes if present
            }
        }
        
        return response.blob(); // Get the response as a Blob
    })
    .then(blob => {
        // Create a temporary URL for the blob
        const url = URL.createObjectURL(blob);
        // Create an audio element
        const audio = new Audio(url);
        // Play the audio
        audio.play();        
    })
    .catch(error => {
        console.error('Error:', error);
    });
});

// load saved choosed model from chrome storage
chrome.storage.sync.get('model', function(data) {
    if (data.model) {
        optionModel = data.model;
        document.getElementById('model-select').value = data.model;
    }
});


// on extension popul frame loaded
document.addEventListener('DOMContentLoaded', async () => {
    const endpoints = await getEndpoints();
    // GET /api/tags to load AI models into popup select with id model-select
    fetch(endpoints.llmEndpoint+'/api/tags').then(response => response.json())
        .then(data => {
            console.log('Models:', JSON.stringify(data));
            const models = data.models;
            const modelSelect = document.getElementById('model-select');
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.model;
                option.text = model.name;
                // check if current model is same as optionModel then select it
                if (optionModel == model.model) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error:', error)
        });

});

// on model select change
document.getElementById('model-select').addEventListener('change', function() {
    optionModel = this.value;
    // Save the selected model to Chrome storage as key model
    chrome.storage.sync.set({model: optionModel}, function() {
        console.log('Model saved:',
            JSON.stringify({model: optionModel}));
    });
});

document.getElementById('copyit').addEventListener('click', function() {
    const copyText = document.getElementById('summary').innerText;

    // Use the Clipboard API for modern browsers
    if (navigator.clipboard) {
        navigator.clipboard.writeText(copyText)
            .then(() => {
                console.log('Text copied to clipboard');
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
                // Handle the error, maybe show an alert to the user
                alert('Failed to copy text to clipboard!');
            });
    } else {
        // Fallback for older browsers (less reliable)
        copyToClipboardFallback(copyText);
    }
});

document.getElementById('options-button').addEventListener('click', function() {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});

function getCurrentPageContent() {
    return document.body.innerText;
}

