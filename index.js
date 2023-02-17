const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { OAuth2Client } = require('google-auth-library');

// Ustawienia autoryzacji
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';

// Ustawienia Gmail API
const gmail = google.gmail('v1');

// Ustawienia pobierania załączników

const BLACK_LIST = ["smyk"];


const MONTH = 0; // numer miesiąca (0 - styczeń, 1 - luty, ...)
const YEAR = 2023; // rok

const DOWNLOAD_DIR = `attachments/${MONTH + 1}-${YEAR}`;

// Funkcja autoryzacji
async function authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

    try {
        const token = await fs.promises.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (err) {
        return getNewToken(oAuth2Client);
    }
}

// Funkcja pobierająca nowy token
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    console.log('Authorize this app by visiting this url:', authUrl);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Enter the code from that page here: ', async (code) => {
        rl.close();
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            await fs.promises.writeFile(TOKEN_PATH, JSON.stringify(tokens));
            console.log('Token stored to', TOKEN_PATH);
            return oAuth2Client;
        } catch (err) {
            console.error('Error while trying to retrieve access token', err);
            process.exit(1);
        }
    });
}

// Funkcja pobierająca załączniki
async function getAttachments(auth) {
    const monthStart = new Date(YEAR, MONTH, 1).toISOString().split('T')[0];
    const monthEnd = new Date(YEAR, MONTH + 1, 0).toISOString().split('T')[0];

    const res = await gmail.users.messages.list({
        auth,
        userId: 'me',
        q: `has:attachment after:${monthStart} before:${monthEnd}`,
    });

    const messages = res.data.messages ?? [];

    console.log('messages from ', monthStart, ' to ', monthEnd);
    if (messages.length === 0) {
        console.log('No messages found.');
        console.log(res.data)
        return;
    }

    await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });

    // kod z poprzedniego bloku

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageRes = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.id,
            format: 'full',
        });

        const headers = messageRes.data.payload.headers;
        let filename = '';

        for (let j = 0; j < headers.length; j++) {
            if (headers[j].name === 'Subject') {
                filename = headers[j].value;
            }
        }

        const parts = messageRes.data.payload.parts;
        if (!parts || parts.length === 0) {
            console.log(`Message ${message.id} has no attachments.`);
            continue;
        }

        for (let j = 0; j < parts.length; j++) {
            const part = parts[j];
            const mimeType = part.mimeType;

            if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
                const body = part.body;
                if (body.attachmentId) {
                    const attachmentRes = await gmail.users.messages.attachments.get({
                        auth,
                        userId: 'me',
                        messageId: message.id,
                        id: body.attachmentId,
                    });

                    const data = attachmentRes.data.data;
                    const dataBuffer = Buffer.from(data, 'base64');

                    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
                    const sanitiezedName = sanitizeFilename(filename);
                    const filenameWithExt = `${sanitiezedName ? sanitiezedName : generateRandomString(10)}.${ext}`;

                    if (isFilenameInBlacklist(filenameWithExt)) {
                        continue;
                    }

                    const filepath = path.join(DOWNLOAD_DIR, filenameWithExt);
                    await fs.promises.writeFile(filepath, dataBuffer);
                    console.log(`Attachment saved to ${filepath}`);
                }
            }
        }
    }
}

// Funkcja główna
async function main() {
    try {
        const credentials = require('./credentials.json');
        const auth = await authorize(credentials);
        await getAttachments(auth);
    } catch (err) {
        console.error(err);
    }
}

main();
function sanitizeFilename(filename) {
    // Replace characters that are not letters, numbers, spaces, underscores, or dashes with an empty string
    return filename.replace(/[^a-zA-Z0-9 _-]/g, '');
}


function isFilenameInBlacklist(name) {
    const blackListRegex = new RegExp(BLACK_LIST.join('|'), 'i');
    return blackListRegex.test(name)
}
function generateRandomString(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}
