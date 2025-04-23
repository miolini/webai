var optionModel = "";
let currentPageContent = null; // Store page content globally
let isFetchingContent = false; // Flag to prevent multiple fetches
let conversationHistory = []; // Store conversation messages { role: 'user'/'assistant', content: '...' }

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

// Helper function to append messages to the display
function appendMessageToDisplay(role, content) {
    const summaryElement = document.getElementById('summary');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${role}`); // Add base and role-specific class

    if (role === 'user') {
        messageDiv.innerText = content; // User messages as plain text
    } else {
        messageDiv.innerHTML = renderMarkdown(content); // Render markdown for assistant/summary
    }

    summaryElement.appendChild(messageDiv);

    // Scroll to the bottom to show the latest message
    summaryElement.scrollTop = summaryElement.scrollHeight;
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
         // Keep error message outside the chat flow for clarity
         document.getElementById('status').innerText = 'Page content not available. Cannot summarize.';
         document.getElementById('status').style.display = 'block';
         setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
         console.error('Content not available for summarization.');
         return;
    }

    document.getElementById('status').innerText = 'Summarizing...';
    document.getElementById('status').style.display = 'block';
    // Clear previous conversation display and history
    document.getElementById('summary').innerHTML = ''; 
    conversationHistory = []; 

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
                prompt: currentPageContent, // Use stored content for summary
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

        // Append summary to display
        appendMessageToDisplay('summary', llmResponse);
        // Add summary as the first assistant message in history for context in subsequent questions
        conversationHistory.push({ role: 'assistant', content: llmResponse }); 

    } catch (error) {
        console.error('Error during summarization:', error);
        // Show error in status, not in chat
        document.getElementById('status').innerText = `An error occurred while summarizing: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible on error
    } finally {
         // Hide status only if successful, otherwise keep error message visible
         if (!document.getElementById('status').innerText.startsWith('An error')) {
            document.getElementById('status').style.display = 'none';
         }
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
         // Keep error message outside the chat flow
         document.getElementById('status').innerText = 'Page content not available. Cannot answer question.';
         document.getElementById('status').style.display = 'block';
         setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
         console.error('Content not available for asking question.');
         return;
    }

    // Append user question to display immediately
    appendMessageToDisplay('user', userQuestion);
    // Add user question to history before sending
    conversationHistory.push({ role: 'user', content: userQuestion });
    questionInput.value = ''; // Clear input after adding to display/history

    document.getElementById('status').innerText = 'Thinking...';
    document.getElementById('status').style.display = 'block';
    // Don't clear the summary div anymore

    const model = document.getElementById('model-select').value;
    const askSystemPrompt = 
        `You are a helpful assistant. Answer the user's question based `+
        `only on the provided text content from a webpage and the preceding conversation history. Be concise and accurate. `+
        `If the answer is not found in the text or history, try to reason about the most probable answer based on your knowledge and the provided context.`;

    // Build the prompt including history
    let promptWithHistory = `Webpage Content:\n---\n${currentPageContent}\n---\n\nConversation History:\n`;
    conversationHistory.forEach(msg => {
        // Simple formatting for the prompt
        promptWithHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
    });
    // The last message added was the current user question, so the prompt naturally ends with it.

    try {
        const endpoints = await getEndpoints();
        const response = await fetch(endpoints.llmEndpoint + "/api/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                system: askSystemPrompt, // System prompt provides overall instruction
                prompt: promptWithHistory, // Prompt contains content and history
                stream: false,
                options: {
                    temperature: 0.1, // Lower temperature for factual Q&A
                    num_ctx: 16384
                }
            })
        });

        if (!response.ok) {
            // Remove the user's last question from history if the API call fails
            conversationHistory.pop(); 
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let llmResponse = data.response;
        // Basic cleaning
        llmResponse = llmResponse.replace(/<think>(.|\n)*?<\/think>/g, '').trim();

        // Append assistant answer to display
        appendMessageToDisplay('assistant', llmResponse);
        // Add assistant answer to history
        conversationHistory.push({ role: 'assistant', content: llmResponse });

    } catch (error) {
        console.error('Error during asking question:', error);
        // Show error in status
        document.getElementById('status').innerText = `An error occurred while asking the question: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible
        // Optionally remove the user message from display if the call failed? Or add an error message?
        // For simplicity, just show error in status for now.
    } finally {
        // Hide status only if successful
        if (!document.getElementById('status').innerText.startsWith('An error')) {
            document.getElementById('status').style.display = 'none';
        }
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
    let copyText = '';

    // Iterate through messages and build plain text representation
    summaryElement.childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('message')) {
            let prefix = '';
            if (node.classList.contains('message-summary')) {
                prefix = 'Summary:\n';
            } else if (node.classList.contains('message-user')) {
                prefix = 'User: ';
            } else if (node.classList.contains('message-assistant')) {
                prefix = 'Assistant: ';
            }
            copyText += prefix + node.innerText + '\n\n'; // Add double newline for separation
        }
    });

    copyText = copyText.trim(); // Remove trailing newlines

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

