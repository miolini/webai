var optionModel = "";
let currentPageContent = null; // Store page content globally
let isFetchingContent = false; // Flag to prevent multiple fetches
let conversationHistory = []; // Store conversation messages { role: 'user'/'assistant', content: '...' }
let currentPageUrl = null; // Store current page URL

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

// --- History Persistence Functions ---
async function saveHistory(url, history) {
    if (!url || !history) return;
    try {
        await chrome.storage.local.set({ [url]: history });
        console.log('History saved for:', url);
    } catch (error) {
        console.error('Error saving history:', error);
    }
}

async function loadAndRenderHistory(url) {
    const summaryElement = document.getElementById('summary');
    summaryElement.innerHTML = ''; // Clear previous display
    conversationHistory = []; // Reset global history

    if (!url) return;

    try {
        const items = await chrome.storage.local.get(url);
        if (items && items[url]) {
            conversationHistory = items[url];
            console.log('History loaded for:', url, conversationHistory);

            // Render loaded history
            conversationHistory.forEach((message, index) => {
                // The first assistant message is treated as the summary for display purposes
                const displayRole = (index === 0 && message.role === 'assistant') ? 'summary' : message.role;
                appendMessageToDisplay(displayRole, message.content);
            });
        } else {
            console.log('No history found for:', url);
        }
    } catch (error) {
        console.error('Error loading history:', error);
        // Don't overwrite display if loading fails, maybe show an error?
    }
}

async function clearHistory(url) {
    if (!url) return;
    try {
        await chrome.storage.local.remove(url);
        console.log('History cleared for:', url);
    } catch (error) {
        console.error('Error clearing history:', error);
    }
}
// --- End History Persistence Functions ---

// Refactored Speech Synthesis Function
async function speakText(textToSpeak) {
    if (!textToSpeak) {
        console.log('No text provided to speak.');
        return;
    }
    console.log('Attempting to speak:', textToSpeak.substring(0, 50) + '...'); // Log start of text
    const speakButton = document.getElementById('speakit'); // Or get specific micro-button if needed
    const originalButtonText = speakButton?.innerText; // Store original text if applicable
    if (speakButton) speakButton.innerText = 'Speaking...'; // Indicate activity

    try {
        const endpoints = await getEndpoints();
        const response = await fetch(endpoints.speechEndpoint + '/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'kokoro', // Consider making this configurable
                voice: 'af_sky', // Consider making this configurable
                speed: 1.0,
                input: textToSpeak
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        audio.onended = () => {
            URL.revokeObjectURL(url);
            if (speakButton && originalButtonText) speakButton.innerText = originalButtonText; // Restore text
            console.log('Speech finished.');
        };
        audio.onerror = (e) => {
             console.error('Audio playback error:', e);
             if (speakButton && originalButtonText) speakButton.innerText = originalButtonText; // Restore text on error
             alert('Error playing audio.');
        };

    } catch (error) {
        console.error('Error during speech synthesis:', error);
        if (speakButton && originalButtonText) speakButton.innerText = originalButtonText; // Restore text on error
        alert(`Could not play speech: ${error.message}`);
    }
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

    const contentDiv = document.createElement('div'); // Div for the actual content
    contentDiv.classList.add('message-content');

    if (role === 'user') {
        contentDiv.innerText = content; // User messages as plain text
    } else { // Handles 'assistant' and 'summary' roles
        contentDiv.innerHTML = renderMarkdown(content); // Render markdown for assistant/summary
    }
    messageDiv.appendChild(contentDiv); // Add content first

    // --- Add Action Buttons ---
    const actionsDiv = document.createElement('div');
    actionsDiv.classList.add('message-actions');

    // Listen Button (only for assistant/summary)
    if (role === 'assistant' || role === 'summary') {
        const listenButton = document.createElement('button');
        listenButton.classList.add('micro-button', 'listen-button');
        listenButton.textContent = 'Listen';
        listenButton.title = 'Read this message aloud';
        listenButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent potential parent clicks
            const textToSpeak = messageDiv.querySelector('.message-content')?.innerText || '';
            speakText(textToSpeak); // Use the refactored function
        });
        actionsDiv.appendChild(listenButton);
    }

    // Copy Button
    const copyButton = document.createElement('button');
    copyButton.classList.add('micro-button', 'copy-button');
    copyButton.textContent = 'Copy';
    copyButton.title = 'Copy this message text';
    copyButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = messageDiv.querySelector('.message-content')?.innerText || '';
        if (navigator.clipboard && textToCopy) {
            navigator.clipboard.writeText(textToCopy)
                .then(() => {
                    console.log('Message copied to clipboard');
                    const originalText = copyButton.textContent;
                    copyButton.textContent = 'Copied!';
                    setTimeout(() => { copyButton.textContent = originalText; }, 1500);
                })
                .catch(err => {
                    console.error('Failed to copy message text: ', err);
                    alert('Failed to copy text.');
                });
        } else if (!textToCopy) {
             console.log('Nothing to copy from this message.');
        } else {
            alert('Clipboard API not available.'); // Basic fallback message
        }
    });
    actionsDiv.appendChild(copyButton);

    messageDiv.appendChild(actionsDiv); // Add actions container to message
    // --- End Action Buttons ---

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
    currentPageUrl = null; // Reset URL initially

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error("Could not get active tab.");
        }
        if (!tab.url || !tab.url.startsWith('http')) {
             throw new Error("Cannot get content from this page (invalid URL).");
        }
        currentPageUrl = tab.url; // Store the URL

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
            // Load history *after* successfully getting content and URL
            await loadAndRenderHistory(currentPageUrl);
        } else {
            throw new Error("Failed to get page content from results.");
        }
    } catch (error) {
        console.error('Error fetching page content:', error);
        document.getElementById('status').innerText = `Error fetching content: ${error.message}`;
        document.getElementById('summary').innerText = 'Could not fetch page content. Please try reloading the page or extension.';
        currentPageContent = null; // Reset content on error
        currentPageUrl = null; // Reset URL on error
        conversationHistory = []; // Clear history on error
        document.getElementById('summary').innerHTML = ''; // Clear display on error
    } finally {
        isFetchingContent = false;
        // Ensure status is hidden if successful or if error message is shown in summary
        if (!currentPageContent) {
             setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
        } else {
             // Status is hidden inside the try block if successful
        }
    }
}

document.getElementById('summarize-button').addEventListener('click', async () => {
    console.log('Summarize button clicked');
    // Ensure content is fetched (which also sets URL and loads history)
    if (!currentPageContent && !isFetchingContent) {
        await fetchAndStorePageContent();
    }
    // Check again after attempting fetch
    if (!currentPageContent || !currentPageUrl) {
         document.getElementById('status').innerText = 'Page content or URL not available. Cannot summarize.';
         document.getElementById('status').style.display = 'block';
         setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
         console.error('Content or URL not available for summarization.');
         return;
    }

    document.getElementById('status').innerText = 'Summarizing...';
    document.getElementById('status').style.display = 'block';
    // Clear previous conversation display and history *before* new summary
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

        // Append summary to display (using 'summary' role for styling)
        appendMessageToDisplay('summary', llmResponse);
        // Add summary as the first assistant message in history
        conversationHistory.push({ role: 'assistant', content: llmResponse });
        // Save the updated history
        await saveHistory(currentPageUrl, conversationHistory);

    } catch (error) {
        console.error('Error during summarization:', error);
        // Show error in status, not in chat
        document.getElementById('status').innerText = `An error occurred while summarizing: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible on error
        // Clear potentially broken history state if summary failed
        conversationHistory = [];
        document.getElementById('summary').innerHTML = ''; // Clear display
        await saveHistory(currentPageUrl, conversationHistory); // Save cleared history
    } finally {
         // Hide status only if successful, otherwise keep error message visible
         if (!document.getElementById('status').innerText.startsWith('An error')) {
            document.getElementById('status').style.display = 'none';
         }
    }
});

// Function to handle asking a question
async function handleAskQuestion() {
    const questionInput = document.getElementById('question-input');
    const userQuestion = questionInput.value.trim();

    if (!userQuestion) {
        // Optionally show a subtle hint or do nothing if empty
        // alert('Please enter a question.'); // Avoid alert for better UX on Enter press
        return;
    }

    console.log('Asking question:', userQuestion);
    // Ensure content is fetched (which also sets URL and loads history if needed)
    if (!currentPageContent && !isFetchingContent) {
        await fetchAndStorePageContent();
    }
    // Check again after attempting fetch
    if (!currentPageContent || !currentPageUrl) {
         document.getElementById('status').innerText = 'Page content or URL not available. Cannot answer question.';
         document.getElementById('status').style.display = 'block';
         setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
         console.error('Content or URL not available for asking question.');
         return;
    }

    // Append user question to display immediately
    appendMessageToDisplay('user', userQuestion);
    // Add user question to history before sending
    const userMessage = { role: 'user', content: userQuestion };
    conversationHistory.push(userMessage);
    // Don't save history yet, wait for assistant response
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
        // Simple formatting for the prompt - treat 'summary' role as 'Assistant' for LLM context
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
        // Save the updated history
        await saveHistory(currentPageUrl, conversationHistory);

    } catch (error) {
        console.error('Error during asking question:', error);
        // Show error in status
        document.getElementById('status').innerText = `An error occurred while asking the question: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible
        // Remove the user message from display if the call failed?
        const messages = document.querySelectorAll('.message-user');
        if (messages.length > 0) {
            messages[messages.length - 1].remove(); // Remove last user message visually
        }
        // History was already popped in the error handler if response was not ok
    } finally {
        // Hide status only if successful
        if (!document.getElementById('status').innerText.startsWith('An error')) {
            document.getElementById('status').style.display = 'none';
        }
    }
}

// Remove the original 'ask-button' event listener
/*
document.getElementById('ask-button').addEventListener('click', async () => {
    // ... all the logic is now in handleAskQuestion ...
});
*/

// Add event listener for the Clear button
document.getElementById('clear-button').addEventListener('click', async () => {
    console.log('Clear button clicked');
    if (!currentPageUrl) {
        console.log('No current page URL, cannot clear history.');
        // Optionally show a status message
        document.getElementById('status').innerText = 'Cannot clear history: Page URL not found.';
        document.getElementById('status').style.display = 'block';
        setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 2000);
        return;
    }

    // Clear the display
    document.getElementById('summary').innerHTML = '';
    // Clear the in-memory history
    conversationHistory = [];
    // Clear the stored history
    await clearHistory(currentPageUrl);

    // Optional: Provide feedback
    document.getElementById('status').innerText = 'Chat history cleared.';
    document.getElementById('status').style.display = 'block';
    setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 1500);
});

// Add event listener for Enter key in the question input
document.getElementById('question-input').addEventListener('keydown', function(event) {
    // Check if the pressed key is Enter
    if (event.key === 'Enter') {
        // Prevent the default action (e.g., form submission if it were inside a form)
        event.preventDefault();
        // Directly call the handler function
        handleAskQuestion();
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
    // Fetch page content and load history as soon as the popup loads
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
            // Use classes set by appendMessageToDisplay for labeling
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

