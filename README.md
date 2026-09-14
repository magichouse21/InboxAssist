## InboxAssist

How to run InboxAssist locally:

- install Node.js dependencies:
    npm install

- build the extension:
    npm run build

- open `chrome://extensions` in Chrome
- enable **Developer mode**
- click **Load unpacked** and select the `dist/` folder

- open the extension Options page
- copy the displayed Microsoft OAuth redirect URI into the Microsoft Entra app registration
- sign in with a personal Microsoft account
- enter your Gemini API key, click **Save key**, and use **Test connection**
- run `npm test` to execute the automated checks

How to use InboxAssist:
- go to outlook.office.com
- click on an email
- click on the extension icon and use Summarize, Search, Q&A, or Compose

The previous Python/Flask implementation is preserved under `legacy-python/`
for migration reference and is not required to run the extension.
