chrome.action.onClicked.addListener(async (tab) => {
    // Get active tab URL
    console.log('Button clicked');
    document.getElementById('status').style.display = 'block';
    document.getElementById('summary').innerText = ''; 

    // const [tab] = await chrome.tabs.query({active: true, currentWindow: true});

    // Execute script in the context of the current page
    chrome.scripting.executeScript({
        target: {tabId: tab.id},
        function: getCurrentPageContent,
    }, (results) => {
        if (chrome.runtime.lastError) {
            console.error(
                JSON.stringify(chrome.runtime.lastError));
            document.getElementById('status').style.display = 'none';
            document.getElementById('summary').innerText = 'An error occurred while fetching the page content.';
        
            return;
        }

        const content = results[0].result;

        // Send the content to OpenAI API
        fetch('http://192.168.1.70:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'deepseek-r1:7b',
                prompt: `Summarize the following content to major takeaways:\n\n${content}`,
                stream: false,
                format: 'json'
            })
        }).then(response => {
            console.log('Response:', response);
            response.json()
        })
        .then(data => {
            console.log('Summary:', JSON.stringify(data));
            document.getElementById('status').style.display = 'none';
            document.getElementById('summary').innerText = data;
        })
        .catch(error => {
            console.error('Error:', error)
            document.getElementById('status').style.display = 'none';
            document.getElementById('summary').innerText = 'An error occurred while summarizing the page content.';
        
        });
    });
});

function getCurrentPageContent() {
    return document.body.innerText;
}