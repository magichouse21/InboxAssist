## InboxAssist

How to run InboxAssist:

- install all necessary packages:
    pip install -r requirements.txt

- create a .env file containing gemini api key and model

- run the server:
    python main.py

- run on another terminal:
    Invoke-WebRequest -Uri http://localhost:5000/index-inbox -Method POST -UseBasicParsing

- switch back to Flask terminal and open https://login.microsoft.com/device to authenticate with given code

- load the chrome extension:
    go to chrome://extensions
    enable 'Developer mode'
    click 'Load unpacked'
    select our project folder
    Inbox Assist 0.1 should appear in extension box

How to use InboxAssist:
- go to outlook.office.com
- click on an email
- click on the extension icon and select your service
