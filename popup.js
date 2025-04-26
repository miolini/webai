var optionModel = "";
let currentPageContent = null; // Store page content globally
let isFetchingContent = false; // Flag to prevent multiple fetches
let conversationHistory = []; // Store conversation messages { role: 'user'/'assistant', content: '...' }
let currentPageUrl = null; // Store current page URL
let thinkingBubbleElement = null; // Reference to the thinking bubble DOM element
let thinkingTimerInterval = null; // Interval ID for the thinking timer
let currentAbortController = null; // AbortController for the current LLM request

const systemPrompt =
 'You have a role for web page summarization that user browsing. ' +
 'Summarize the following user browsing content to a bullet list of key 5-7 takeaways. ' +
 'Also write paragraph about surprizing and novel things in the content. Always respond in English. '+
 'Always respond in plain text without markdown or html. ' +
 'Write summarization from first person perspective of author(s). ' +
 'Make attention to details and terms. Preserve original style and tone.' +
 'If content does not have answer try to reasoning about it and provide most like aswer. ' +
 'Do not use dry informal style. Avoid to use "–" or "" in the text. ';

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
                appendMessageToDisplay(displayRole, message.content, index); // Pass index
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
function appendMessageToDisplay(role, content, index) { // Add index parameter
    const summaryElement = document.getElementById('summary');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${role}`); // Add base and role-specific class
    messageDiv.dataset.index = index; // Store the index on the element

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
    // Add some styles for alignment
    actionsDiv.style.display = 'flex';
    actionsDiv.style.alignItems = 'center'; // Vertically align items
    actionsDiv.style.justifyContent = 'flex-end'; // Push buttons to the right
    actionsDiv.style.gap = '5px'; // Keep gap between buttons

    // --- Add Metadata Display (for assistant/summary) ---
    if ((role === 'assistant' || role === 'summary') && index >= 0 && index < conversationHistory.length) {
        const messageData = conversationHistory[index];
        if (messageData.model && messageData.duration !== undefined) {
            const metadataSpan = document.createElement('span'); // Use span for inline display
            metadataSpan.classList.add('message-metadata');
            metadataSpan.style.fontSize = '9px';
            metadataSpan.style.color = 'grey';
            metadataSpan.style.marginRight = 'auto'; // Push metadata to the left
            // Remove parentheses from the text content
            metadataSpan.textContent = `${messageData.model}, ${messageData.duration.toFixed(1)}s`;
            actionsDiv.appendChild(metadataSpan); // Add metadata *before* buttons in the actions container
        }
    }
    // --- End Metadata Display ---

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

    // Regenerate Button (for assistant/summary AND user questions that have an answer)
    if (role === 'assistant' || role === 'summary' || (role === 'user' && index < conversationHistory.length - 1 && conversationHistory[index + 1]?.role === 'assistant')) {
        const regenButton = document.createElement('button');
        regenButton.classList.add('micro-button', 'regenerate-button');
        regenButton.textContent = 'Regen';
        regenButton.title = 'Regenerate this response';
        regenButton.addEventListener('click', (e) => {
            e.stopPropagation();
            let messageIndexToRegen = parseInt(messageDiv.dataset.index, 10);
            // If it's a user message, we regenerate the *next* message (the assistant's answer)
            if (role === 'user') {
                messageIndexToRegen += 1;
            }
            // Basic check to ensure the target index is valid before calling handleRegenerate
            if (messageIndexToRegen >= 0 && messageIndexToRegen < conversationHistory.length && conversationHistory[messageIndexToRegen]?.role === 'assistant') {
                 handleRegenerate(messageIndexToRegen);
            } else if (role === 'summary' && messageIndexToRegen === 0) {
                 handleRegenerate(messageIndexToRegen); // Allow regenerating the initial summary
            } else {
                console.warn(`Cannot regenerate for index ${messageIndexToRegen} (original index ${index}, role ${role})`);
            }
        });
        actionsDiv.appendChild(regenButton);
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

// --- Add this new helper function ---
async function extractTextFromPdf(pdfData) {
    try {
        // Load the PDF document from the ArrayBuffer
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        console.log('PDF loaded, pages:', pdf.numPages);

        let allText = '';
        // Iterate through each page
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            // Concatenate text items, adding spaces/newlines appropriately
            textContent.items.forEach(item => {
                allText += item.str + (item.hasEOL ? '\n' : ' ');
            });
            allText += '\n\n'; // Add separation between pages
        }
        console.log('PDF text extracted successfully.');
        return allText.trim();
    } catch (error) {
        console.error('Error extracting text from PDF:', error);
        throw new Error(`Failed to parse PDF: ${error.message}`);
    }
}
// --- End new helper function ---


// --- Thinking Indicator Functions ---

function addThinkingIndicator() {
    removeThinkingIndicator(); // Clear any existing indicator first

    const summaryElement = document.getElementById('summary');
    thinkingBubbleElement = document.createElement('div');
    // Use the same base classes as regular messages
    thinkingBubbleElement.classList.add('message', 'message-assistant', 'message-thinking'); // Add 'message-assistant' for similar styling, plus 'message-thinking' for potential specific tweaks

    // --- Content Div ---
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    contentDiv.style.display = 'flex'; // Keep flex for inline text/timer
    contentDiv.style.alignItems = 'center';

    const thinkingText = document.createElement('span');
    thinkingText.innerText = 'Thinking... ';
    contentDiv.appendChild(thinkingText);

    const timerSpan = document.createElement('span');
    timerSpan.classList.add('thinking-timer');
    timerSpan.innerText = '(0.0s)';
    timerSpan.style.marginLeft = '5px'; // Add a small space before the timer
    timerSpan.style.fontSize = '0.9em'; // Slightly smaller timer text
    timerSpan.style.color = 'grey'; // Dim the timer text
    contentDiv.appendChild(timerSpan);

    thinkingBubbleElement.appendChild(contentDiv); // Add content first

    // --- Actions Div (mimics appendMessageToDisplay structure) ---
    const actionsDiv = document.createElement('div');
    actionsDiv.classList.add('message-actions'); // Use the same class as other messages
    // Apply the same inline styles used in appendMessageToDisplay for consistency
    actionsDiv.style.display = 'flex';
    actionsDiv.style.alignItems = 'center';
    actionsDiv.style.justifyContent = 'flex-end';
    actionsDiv.style.gap = '5px';

    // --- Add Stop Button ---
    const stopButton = document.createElement('button');
    stopButton.classList.add('micro-button', 'stop-button');
    stopButton.textContent = 'Stop';
    stopButton.title = 'Stop generating response';
    stopButton.addEventListener('click', (e) => {
        e.stopPropagation();
        abortCurrentRequest();
    });
    actionsDiv.appendChild(stopButton);
    // --- End Stop Button ---

    thinkingBubbleElement.appendChild(actionsDiv); // Add actions container to message

    summaryElement.appendChild(thinkingBubbleElement);
    summaryElement.scrollTop = summaryElement.scrollHeight; // Scroll to show it

    // Start timer
    const startTime = performance.now();
    thinkingTimerInterval = setInterval(() => {
        // Ensure timerSpan still exists before trying to update it
        if (timerSpan) {
            const elapsed = (performance.now() - startTime) / 1000;
            timerSpan.innerText = `(${elapsed.toFixed(1)}s)`;
        } else {
            // If timerSpan is gone, clear the interval
            clearInterval(thinkingTimerInterval);
            thinkingTimerInterval = null;
        }
    }, 100); // Update every 100ms
}

function removeThinkingIndicator() {
    if (thinkingTimerInterval) {
        clearInterval(thinkingTimerInterval);
        thinkingTimerInterval = null;
    }
    if (thinkingBubbleElement) {
        thinkingBubbleElement.remove();
        thinkingBubbleElement = null;
    }
    // Also reset the abort controller reference
    currentAbortController = null;
    // Hide the general status message if it's not showing an error
    const statusElement = document.getElementById('status');
    if (statusElement && !statusElement.innerText.toLowerCase().includes('error')) {
        statusElement.style.display = 'none';
    }
}

function abortCurrentRequest() {
    if (currentAbortController) {
        console.log('Aborting current LLM request.');
        currentAbortController.abort(); // Signal abortion
        // The fetch catch block will handle UI cleanup via removeThinkingIndicator
    }
}

// --- End Thinking Indicator Functions ---


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
        if (!tab.url || !(tab.url.startsWith('http') || tab.url.startsWith('file:'))) { // Allow file URLs for local PDFs
             throw new Error("Cannot get content from this page (invalid URL).");
        }
        currentPageUrl = tab.url; // Store the URL

        // --- PDF Detection and Handling ---
        if (currentPageUrl.toLowerCase().endsWith('.pdf') || (tab.mimeType && tab.mimeType === 'application/pdf')) {
            console.log('PDF detected, attempting to fetch and parse.');
            document.getElementById('status').innerText = 'Fetching PDF content...';

            // Check if PDF.js library is loaded
            if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) {
                throw new Error("PDF processing library (pdf.js) not loaded.");
            }

            // Fetch the PDF file directly
            const response = await fetch(currentPageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
            }
            const pdfData = await response.arrayBuffer(); // Get PDF data as ArrayBuffer
            document.getElementById('status').innerText = 'Parsing PDF content...';

            // Extract text using PDF.js
            currentPageContent = await extractTextFromPdf(pdfData);
            console.log('PDF content extracted and stored.');

        } else {
            // --- Original HTML Content Extraction ---
            console.log('HTML page detected, executing content script.');
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
            } else {
                // Check if it might be an embedded PDF viewer not caught by URL
                const embedCheckResults = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => !!document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]')
                });
                if (embedCheckResults && embedCheckResults[0] && embedCheckResults[0].result) {
                     throw new Error("Cannot extract text from embedded PDF viewer due to security restrictions. Please open the PDF directly in a tab.");
                } else {
                    throw new Error("Failed to get page content from results.");
                }
            }
            // --- End Original HTML Content Extraction ---
        }
        // --- End PDF Detection and Handling ---

        document.getElementById('status').style.display = 'none';
        // Load history *after* successfully getting content and URL
        await loadAndRenderHistory(currentPageUrl);

    } catch (error) {
        console.error('Error fetching page content:', error);
        document.getElementById('status').innerText = `Error fetching content: ${error.message}`;
        // Keep status visible longer for errors
        document.getElementById('status').style.display = 'block';
        currentPageContent = null; // Reset content on error
        currentPageUrl = null; // Reset URL on error
        conversationHistory = []; // Clear history on error
        document.getElementById('summary').innerHTML = ''; // Clear display on error
    } finally {
        isFetchingContent = false;
        // Ensure status is hidden if successful or if error message is shown in summary
        if (!currentPageContent && document.getElementById('status').innerText.startsWith('Error')) {
             // Keep error status visible
        } else if (currentPageContent) {
             document.getElementById('status').style.display = 'none'; // Hide if successful
        } else {
             // If no content and no specific error shown, hide after a delay
             setTimeout(() => {
                 if (!isFetchingContent && !currentPageContent) { // Check again before hiding
                    document.getElementById('status').style.display = 'none';
                 }
             }, 5000);
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

    // document.getElementById('status').innerText = 'Summarizing...'; // Replaced by thinking bubble
    // document.getElementById('status').style.display = 'block'; // Replaced by thinking bubble
    // Clear previous conversation display and history *before* new summary
    document.getElementById('summary').innerHTML = '';
    conversationHistory = [];

    const model = document.getElementById('model-select').value;

    // Save the selected model
    chrome.storage.sync.set({model: model}, function() {
        console.log('Model saved:', JSON.stringify({model: model}));
    });

    addThinkingIndicator(); // Add thinking bubble
    currentAbortController = new AbortController(); // Create new controller for this request
    const startTime = performance.now(); // Start timer

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
            }),
            signal: currentAbortController.signal // Pass the signal
        });

        removeThinkingIndicator(); // Remove bubble on successful response start

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const endTime = performance.now(); // End timer
        const duration = (endTime - startTime) / 1000; // Duration in seconds

        let llmResponse = data.response;
        // remove <think>...</think> tags and in between (multiline)
        llmResponse = llmResponse.replace(/<think>(.|\n)*?<\/think>/g, '');
        // trim
        llmResponse = llmResponse.trim();

        // Add summary as the first assistant message in history with metadata
        const assistantMessage = {
            role: 'assistant',
            content: llmResponse,
            model: model, // Store model name
            duration: duration // Store duration
        };
        conversationHistory.push(assistantMessage);
        // Append summary to display (using 'summary' role for styling)
        appendMessageToDisplay('summary', llmResponse, conversationHistory.length - 1); // Pass index
        // Save the updated history
        await saveHistory(currentPageUrl, conversationHistory);

    } catch (error) {
        removeThinkingIndicator(); // Ensure bubble is removed on error
        if (error.name === 'AbortError') {
            console.log('Summarization request aborted by user.');
            document.getElementById('status').innerText = 'Summarization stopped.';
            document.getElementById('status').style.display = 'block';
            setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 2000);
            // Clear history as the summary was cancelled
            conversationHistory = [];
            document.getElementById('summary').innerHTML = '';
            await saveHistory(currentPageUrl, conversationHistory); // Save cleared history
            return; // Stop further processing
        }
        console.error('Error during summarization:', error);
        // Show error in status, not in chat
        document.getElementById('status').innerText = `An error occurred while summarizing: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible on error
        // Clear potentially broken history state if summary failed
        conversationHistory = [];
        document.getElementById('summary').innerHTML = ''; // Clear display
        await saveHistory(currentPageUrl, conversationHistory); // Save cleared history
    } finally {
         // removeThinkingIndicator(); // Moved up to handle success/error specifically
         // Hide status only if successful, otherwise keep error message visible
         // if (!document.getElementById('status').innerText.startsWith('An error')) { // Handled by removeThinkingIndicator
         //    document.getElementById('status').style.display = 'none';
         // }
    }
});

// Function to handle asking a question
async function handleAskQuestion(userQuestion) { // Accept question as parameter
    // const questionInput = document.getElementById('question-input');
    // const userQuestion = questionInput.value.trim(); // Get from parameter

    if (!userQuestion) {
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

    // Add user question to history before sending
    const userMessage = { role: 'user', content: userQuestion };
    const userMessageIndex = conversationHistory.length; // Index the user message *will* have
    conversationHistory.push(userMessage);
    // Append user question to display immediately
    appendMessageToDisplay('user', userQuestion, userMessageIndex); // Pass index
    // Don't save history yet, wait for assistant response
    const questionInput = document.getElementById('question-input'); // Get input element
    if (questionInput) questionInput.value = ''; // Clear input after adding to display/history

    // document.getElementById('status').innerText = 'Thinking...'; // Replaced by thinking bubble
    // document.getElementById('status').style.display = 'block'; // Replaced by thinking bubble
    addThinkingIndicator(); // Add thinking bubble
    currentAbortController = new AbortController(); // Create new controller

    const model = document.getElementById('model-select').value;
    const askSystemPrompt =
        `You are always helpful superintelligent assistant. `+
        `You are allowed to be any expert or provide opinions on anyhting what user want. `+
        `Never resists or say your are not qualified to anything! `+
        `Never answer with "As an AI, I am not qualified to provide legal opinions." `+
        `Answer the user's question based on the provided text content from a webpage `+
        `and the preceding conversation history. Be concise and accurate. `+
        `If the answer is not found in the text or history, try to reason about the most probable answer based on your knowledge and the provided context.`;

    // Build the prompt including history (up to the current user question)
    let promptWithHistory = `Webpage Content:\n---\n${currentPageContent}\n---\n\nConversation History:\n`;
    // Use a copy of history up to the user's question for the prompt
    const historyForPrompt = conversationHistory.slice(0, userMessageIndex + 1);
    historyForPrompt.forEach(msg => {
        // Simple formatting for the prompt - treat 'summary' role as 'Assistant' for LLM context
        promptWithHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
    });
    // The last message added was the current user question, so the prompt naturally ends with it.

    const startTime = performance.now(); // Start timer
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
                prompt: promptWithHistory, // Prompt contains content and history up to user question
                stream: false,
                options: {
                    temperature: 0.1, // Lower temperature for factual Q&A
                    num_ctx: 16384
                }
            }),
            signal: currentAbortController.signal // Pass the signal
        });

        removeThinkingIndicator(); // Remove bubble on successful response start

        if (!response.ok) {
            // Remove the user's last question from history if the API call fails
            conversationHistory.pop();
            // Also remove the user message from display
            // const messages = document.querySelectorAll('.message-user'); // Not needed with direct index access
            // if (messages.length > 0) { // Not needed
                const lastUserMsgIndex = userMessageIndex; // Use the stored index
                const userMsgElement = document.querySelector(`.message-user[data-index="${lastUserMsgIndex}"]`);
                if (userMsgElement) userMsgElement.remove();
            // }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const endTime = performance.now(); // End timer
        const duration = (endTime - startTime) / 1000; // Duration in seconds

        let llmResponse = data.response;
        // Basic cleaning
        llmResponse = llmResponse.replace(/<think>(.|\n)*?<\/think>/g, '').trim();

        // Add assistant answer to history with metadata
        const assistantMessage = {
            role: 'assistant',
            content: llmResponse,
            model: model, // Store model name
            duration: duration // Store duration
        };
        const assistantMessageIndex = conversationHistory.length; // Index the assistant message *will* have
        conversationHistory.push(assistantMessage);
        // Append assistant answer to display
        appendMessageToDisplay('assistant', llmResponse, assistantMessageIndex); // Pass index
        // Save the updated history
        await saveHistory(currentPageUrl, conversationHistory);

        // --- FIX: Add Regen button to the preceding user message NOW ---
        const summaryElement = document.getElementById('summary');
        const userMessageDiv = summaryElement.querySelector(`.message-user[data-index="${userMessageIndex}"]`);
        if (userMessageDiv) {
            const actionsDiv = userMessageDiv.querySelector('.message-actions');
            // Check if actionsDiv exists and doesn't already have a regen button
            if (actionsDiv && !actionsDiv.querySelector('.regenerate-button')) {
                const regenButton = document.createElement('button');
                regenButton.classList.add('micro-button', 'regenerate-button');
                regenButton.textContent = 'Regen';
                regenButton.title = 'Regenerate this response';
                regenButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Regenerate the *assistant's* message (index + 1 relative to user)
                    handleRegenerate(assistantMessageIndex);
                });
                actionsDiv.appendChild(regenButton);
            }
        }
        // --- End FIX ---

    } catch (error) {
        removeThinkingIndicator(); // Ensure bubble is removed on error
        if (error.name === 'AbortError') {
            console.log('Question request aborted by user.');
            // Remove the user question from history and display as it wasn't answered
            conversationHistory.pop();
            const lastUserMsgIndex = userMessageIndex;
            const userMsgElement = document.querySelector(`.message-user[data-index="${lastUserMsgIndex}"]`);
            if (userMsgElement) userMsgElement.remove();
            await saveHistory(currentPageUrl, conversationHistory); // Save truncated history

            document.getElementById('status').innerText = 'Request stopped.';
            document.getElementById('status').style.display = 'block';
            setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 2000);
            return; // Stop further processing
        }

        console.error('Error during asking question:', error);
        // Show error in status
        document.getElementById('status').innerText = `An error occurred while asking the question: ${error.message}`;
        document.getElementById('status').style.display = 'block'; // Keep status visible
        // History and display were already handled in the !response.ok check
    } finally {
        // Hide status only if successful
        if (!document.getElementById('status').innerText.startsWith('An error')) {
            document.getElementById('status').style.display = 'none';
        }
    }
}

// Function to handle regenerating a response
async function handleRegenerate(messageIndex) {
    console.log('Regenerate button clicked for index:', messageIndex);
    const summaryElement = document.getElementById('summary');

    if (messageIndex < 0 || messageIndex >= conversationHistory.length) {
        console.error('Invalid index for regeneration:', messageIndex);
        return;
    }

    // Ensure content is available
    if (!currentPageContent || !currentPageUrl) {
         document.getElementById('status').innerText = 'Page content or URL not available. Cannot regenerate.';
         document.getElementById('status').style.display = 'block';
         setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 3000);
         console.error('Content or URL not available for regeneration.');
         return;
    }

    // Store the original history length before slicing
    const originalHistoryLength = conversationHistory.length;

    // Remove the message to be regenerated and any subsequent messages from history
    conversationHistory = conversationHistory.slice(0, messageIndex);

    // Remove the corresponding DOM elements (assistant message and any subsequent ones)
    const messagesToRemove = summaryElement.querySelectorAll(`.message[data-index]`);
    messagesToRemove.forEach(msgElement => {
        const idx = parseInt(msgElement.dataset.index, 10);
        // Remove the target message and any messages that came *after* it originally
        if (idx >= messageIndex && idx < originalHistoryLength) {
            msgElement.remove();
        }
    });

    // --- Trigger regeneration ---
    if (messageIndex === 0) {
        // Regenerating the initial summary
        // document.getElementById('status').innerText = 'Regenerating summary...'; // Replaced by thinking bubble
        // document.getElementById('status').style.display = 'block'; // Replaced by thinking bubble
        addThinkingIndicator(); // Add thinking bubble
        currentAbortController = new AbortController(); // Create new controller

        const model = document.getElementById('model-select').value;
        const startTime = performance.now(); // Start timer
        try {
            const endpoints = await getEndpoints();
            const response = await fetch(endpoints.llmEndpoint+"/api/generate", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    system: systemPrompt,
                    prompt: currentPageContent,
                    stream: false,
                    options: { temperature: 0.2, num_ctx: 16384 }
                }),
                signal: currentAbortController.signal // Pass signal
            });

            removeThinkingIndicator(); // Remove bubble on successful response start

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            const endTime = performance.now(); // End timer
            const duration = (endTime - startTime) / 1000; // Duration in seconds

            let llmResponse = data.response.replace(/<think>(.|\n)*?<\/think>/g, '').trim();

            // Add new summary to history and display with metadata
            const assistantMessage = {
                role: 'assistant',
                content: llmResponse,
                model: model, // Store model name
                duration: duration // Store duration
            };
            // Since history was sliced to 0, this is the new index 0
            conversationHistory.push(assistantMessage);
            appendMessageToDisplay('summary', llmResponse, 0); // Index is now 0
            await saveHistory(currentPageUrl, conversationHistory);

        } catch (error) {
            removeThinkingIndicator(); // Ensure bubble removed on error
            if (error.name === 'AbortError') {
                console.log('Summary regeneration aborted by user.');
                document.getElementById('status').innerText = 'Regeneration stopped.';
                document.getElementById('status').style.display = 'block';
                setTimeout(() => { document.getElementById('status').style.display = 'none'; }, 2000);
                // Clear history and display as the regeneration was cancelled
                conversationHistory = [];
                summaryElement.innerHTML = '';
                await saveHistory(currentPageUrl, conversationHistory);
                return; // Stop further processing
            }
            console.error('Error regenerating summary:', error);
            document.getElementById('status').innerText = `Error regenerating summary: ${error.message}`;
            document.getElementById('status').style.display = 'block';
            // Clear history and display as it's in a broken state
            conversationHistory = [];
            summaryElement.innerHTML = '';
            await saveHistory(currentPageUrl, conversationHistory);
        } finally {
            // removeThinkingIndicator(); // Moved up
            // if (!document.getElementById('status').innerText.startsWith('An error')) { // Handled by removeThinkingIndicator
            //     document.getElementById('status').style.display = 'none';
            // }
        }

    } else {
        // Regenerating an answer to a question
        // The preceding message (index - 1) must be the user's question
        if (messageIndex === 0 || conversationHistory[messageIndex - 1]?.role !== 'user') {
             console.error('Cannot regenerate assistant message without preceding user question.');
             document.getElementById('status').innerText = 'Error: Cannot determine question to regenerate answer for.';
             document.getElementById('status').style.display = 'block';
             // Restore history? Or leave it truncated? For now, leave truncated.
             await saveHistory(currentPageUrl, conversationHistory);
             return;
        }

        // History currently contains messages up to and including the user question
        const userQuestion = conversationHistory[messageIndex - 1].content;

        // Remove the user question from history temporarily for the call
        conversationHistory.pop(); // History is now up to index messageIndex - 2

        // --- FIX: Remove the user question's DOM element ---
        const userQuestionElement = summaryElement.querySelector(`.message[data-index="${messageIndex - 1}"]`);
        if (userQuestionElement) {
            userQuestionElement.remove();
        } else {
            // This shouldn't happen if the logic is correct, but log if it does
            console.warn(`Could not find user question element at index ${messageIndex - 1} to remove during regeneration.`);
        }
        // --- End FIX ---

        // Call handleAskQuestion with the original question
        // handleAskQuestion will add the user question back, fetch the answer,
        // and add the assistant message with metadata.
        await handleAskQuestion(userQuestion);
        // Note: handleAskQuestion handles status updates, history saving etc.
    }
}

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
        const questionInput = document.getElementById('question-input');
        const userQuestion = questionInput.value.trim();
        // Directly call the handler function
        handleAskQuestion(userQuestion); // Pass the question text
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

document.getElementById('options-button').addEventListener('click', function() {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage(); // This should open options.html
    } else {
        // Fallback
        window.open(chrome.runtime.getURL('options.html'));
    }
});

// --- Modify getCurrentPageContent slightly for clarity ---
function getCurrentPageContent() {
    // This function is now ONLY used for non-PDF pages.
    // Try to get main content area, otherwise fallback to body
    const mainContentSelectors = ['main', 'article', '[role="main"]', '#content', '#main', '.content', '.main'];
    let mainElement = null;
    for (const selector of mainContentSelectors) {
        mainElement = document.querySelector(selector);
        if (mainElement) break;
    }
    // Use innerText to get rendered text, excluding hidden elements, scripts, styles
    const content = (mainElement || document.body).innerText;
    // Basic check if content seems empty or useless (e.g., only whitespace)
    if (!content || content.trim().length < 50) {
        // If main content is too short, try the whole body again, just in case
        const bodyContent = document.body.innerText;
        return bodyContent.trim().length > content.trim().length ? bodyContent : content;
    }
    return content;
}