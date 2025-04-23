var optionModel = "";
let currentPageContent = null; // Store page content globally
let isFetchingContent = false; // Flag to prevent multiple fetches
const systemPrompt = 
 'You have a role for web page summarization that user browsing. ' +
 'Summarize the following user browsing content to a bullet list of key 5-7 takeaways. ' +
 'Also write paragraph about surprizing and novel things in the content. Always respond in English. '+
 'Always respond in plain text without markdown or html. ' +
 'Write summarization from first person perspective of author(s). ' +
 'Make attention to details and terms. Preserve original style and tone.' +
 'If content does not have answer try to reasoning about it and provide most like aswer. ' +
 'Do not use dry informal style.';

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

function renderMarkdown(text) {
    try {
        // Ensure marked is loaded
        if (typeof marked === 'undefined') {
            console.error('marked.js library not loaded.');
            return `<p>Error: Markdown library not available.</p>`;
        }
        const html = marked.parse(text);
        return html;
    } catch (error) {
        console.error('Error rendering Markdown:', error);
        return `<p>Error rendering Markdown: ${error.message}</p>`;
    }
}

// Function to fetch and store page content
async function fetchAndStorePageContent() {
    if (isFetchingContent || currentPageContent) return; // Don't fetch if already fetching or have content
    isFetchingContent = true;
    document.getElementById('status').innerText = 'Fetching page content...';
    document.getElementById('status').style.display = 'block';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error("Could not get active tab.");
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: getCurrentPageContent,
        });

        if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError));
        }
        if (results && results[0] && results[0].result) {
            currentPageContent = results[0].result;
            console.log('Page content fetched and stored.');
            document.getElementById('status').style.display = 'none';
        } else {
            throw new Error("Failed to get page content from results.");
        }
    } catch (error) {
        console.error('Error fetching page content:', error);
        document.getElementById('status').innerText = `Error fetching content: ${error.message}`;
        document.getElementById('summary').innerText = 'Could not fetch page content. Please try reloading the page or extension.';
        currentPageContent = null; // Reset content on error
    } finally {
        isFetchingContent = false;
        // Ensure status is hidden if successful or if error message is shown in summary
        if (!currentPageContent) {
             setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
        } else {
             document.getElementById('status').style.display = 'none';
        }
    }
}


document.getElementById('summarize-button').addEventListener('click', async () => {
    console.log('Summarize button clicked');
    if (!currentPageContent && !isFetchingContent) {
        await fetchAndStorePageContent(); // Fetch if not already available
    }
    if (!currentPageContent) {
         document.getElementById('summary').innerText = 'Page content not available. Cannot summarize.';
         console.error('Content not available for summarization.');
         return;
    }

    document.getElementById('status').innerText = 'Summarizing...';
    document.getElementById('status').style.display = 'block';
    document.getElementById('summary').innerHTML = ''; 

    const model = document.getElementById('model-select').value;

    // Save the selected model
    chrome.storage.sync.set({model: model}, function() {
        console.log('Model saved:', JSON.stringify({model: model}));
    });  

    try {
        const endpoints = await getEndpoints();
        const response = await fetch(endpoints.llmEndpoint+"/api/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                system: systemPrompt,
                prompt: currentPageContent, // Use stored content
                stream: false,
                options: {
                    temperature: 0.2,
                    num_ctx: 16384
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let llmResponse = data.response;
        // remove <think>...</think> tags and in between (multiline)
        llmResponse = llmResponse.replace(/<think>(.|\n)*?<\/think>/g, '');
        // trim
        llmResponse = llmResponse.trim();

        document.getElementById('summary').innerHTML = renderMarkdown(llmResponse);

    } catch (error) {
        console.error('Error during summarization:', error);
        document.getElementById('summary').innerText = `An error occurred while summarizing: ${error.message}`;
    } finally {
         document.getElementById('status').style.display = 'none';
    }
});

// Add event listener for the new Ask button
document.getElementById('ask-button').addEventListener('click', async () => {
    const questionInput = document.getElementById('question-input');
    const userQuestion = questionInput.value.trim();

    if (!userQuestion) {
        alert('Please enter a question.');
        return;
    }

    console.log('Ask button clicked');
    if (!currentPageContent && !isFetchingContent) {
        await fetchAndStorePageContent(); // Fetch if not already available
    }
    if (!currentPageContent) {
         document.getElementById('summary').innerText = 'Page content not available. Cannot answer question.';
         console.error('Content not available for asking question.');
         return;
    }

    document.getElementById('status').innerText = 'Thinking...';
    document.getElementById('status').style.display = 'block';
    document.getElementById('summary').innerHTML = ''; // Clear previous summary/answer

    const model = document.getElementById('model-select').value;
    const askSystemPrompt = 
        `You are a helpful assistant. Answer the user's question based `+
        `only on the provided text content from a webpage. Be concise and accurate. `+
        `If the answer is not found in the text, try to reason about most probable answer based on your knowledge and provided context. `;
    const askUserPrompt = `Webpage Content:\n---\n${currentPageContent}\n---\n\nQuestion: ${userQuestion}`;

    try {
        const endpoints = await getEndpoints();
        const response = await fetch(endpoints.llmEndpoint + "/api/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                system: askSystemPrompt,
                prompt: askUserPrompt,
                stream: false,
                options: {
                    temperature: 0.1, // Lower temperature for factual Q&A
                    num_ctx: 16384
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let llmResponse = data.response;
        // Basic cleaning
        llmResponse = llmResponse.replace(/<think>(.|\n)*?<\/think>/g, '').trim();

        document.getElementById('summary').innerHTML = renderMarkdown(llmResponse);
        questionInput.value = ''; // Clear input after asking

    } catch (error) {
        console.error('Error during asking question:', error);
        document.getElementById('summary').innerText = `An error occurred while asking the question: ${error.message}`;
    } finally {
        document.getElementById('status').style.display = 'none';
    }
});

// Add event listener for Enter key in the question input
document.getElementById('question-input').addEventListener('keydown', function(event) {
    // Check if the pressed key is Enter
    if (event.key === 'Enter') {
        // Prevent the default action (e.g., form submission if it were inside a form)
        event.preventDefault();
        // Trigger the click event on the ask button
        document.getElementById('ask-button').click();
    }
});


document.getElementById('speakit').addEventListener('click', async () => {
    // contnet from summary id
    const content = document.getElementById('summary').innerText;
    if (!content) {
        console.log('No content in summary to speak.');
        return;
    }
    let filename = 'speech.mp3'; // Default filename, ensure it's declared
    const endpoints = await getEndpoints();
    try {
        const response = await fetch(endpoints.speechEndpoint+'/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'kokoro', // Consider making this configurable
                voice: 'af_sky', // Consider making this configurable
                speed: 1.0,
                input: content
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Check for Content-Disposition header (corrected logic)
        const contentDisposition = response.headers.get('Content-Disposition');
        if (contentDisposition && contentDisposition.includes('attachment')) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(contentDisposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, ''); // Remove quotes if present
                console.log('Using filename from header:', filename);
            }
        }
        
        const blob = await response.blob(); // Get the response as a Blob
        // Create a temporary URL for the blob
        const url = URL.createObjectURL(blob);
        // Create an audio element
        const audio = new Audio(url);
        // Play the audio
        audio.play();
        // Optional: Revoke the object URL after playing to free up memory
        audio.onended = () => URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error during speech synthesis:', error);
        // Optionally notify the user
        alert(`Could not play speech: ${error.message}`);
    }
});

// load saved choosed model from chrome storage
chrome.storage.sync.get('model', function(data) {
    if (data.model) {
        optionModel = data.model;
        // We'll set the value after models are loaded in DOMContentLoaded
    }
});

// on extension popup frame loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Fetch page content as soon as the popup loads
    await fetchAndStorePageContent();

    const endpoints = await getEndpoints();
    // GET /api/tags to load AI models into popup select with id model-select
    try {
        const response = await fetch(endpoints.llmEndpoint+'/api/tags');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Models:', JSON.stringify(data));
        const models = data.models;
        const modelSelect = document.getElementById('model-select');
        modelSelect.innerHTML = ''; // Clear existing options if any
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.model; // Use model id/tag as value
            option.text = model.name;
            // check if current model is same as optionModel then select it
            if (optionModel && optionModel === model.model) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
        // Ensure the global optionModel reflects the selected value if not set previously
        if (!optionModel && modelSelect.options.length > 0) {
             optionModel = modelSelect.value;
             // Optionally save this default selection back to storage
             chrome.storage.sync.set({model: optionModel});
        } else if (optionModel) {
             modelSelect.value = optionModel; // Ensure selection matches stored value
        }

    } catch (error) {
        console.error('Error fetching models:', error);
        const modelSelect = document.getElementById('model-select');
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
        modelSelect.disabled = true;
        document.getElementById('summarize-button').disabled = true;
        document.getElementById('ask-button').disabled = true;
    }
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
    const summaryElement = document.getElementById('summary');
    // Get innerText to avoid copying HTML markup if markdown rendering failed
    const copyText = summaryElement.innerText; 

    if (!copyText) {
        console.log('Nothing to copy.');
        return;
    }

    // Use the Clipboard API for modern browsers
    if (navigator.clipboard) {
        navigator.clipboard.writeText(copyText)
            .then(() => {
                console.log('Text copied to clipboard');
                // Optional: Provide user feedback (e.g., change button text briefly)
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
                alert('Failed to copy text to clipboard!');
            });
    } else {
        // Fallback for older browsers (less reliable, requires text selection)
        try {
            const textArea = document.createElement("textarea");
            textArea.value = copyText;
            textArea.style.position = "fixed"; // Prevent scrolling to bottom
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            console.log('Text copied to clipboard (fallback).');
        } catch (err) {
             console.error('Fallback copy failed: ', err);
             alert('Failed to copy text using fallback method.');
        }
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
    // Try to get main content area, otherwise fallback to body
    const mainContentSelectors = ['main', 'article', '[role="main"]', '#content', '#main', '.content', '.main'];
    let mainElement = null;
    for (const selector of mainContentSelectors) {
        mainElement = document.querySelector(selector);
        if (mainElement) break;
    }
    // Use innerText to get rendered text, excluding hidden elements, scripts, styles
    return (mainElement || document.body).innerText;
}

