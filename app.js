'use strict';

// mi importo i moduli che servono per l'elaborazione
const dialogflow = require('dialogflow');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');


// mi importo il file di configurazione 
const config = require('./config');

const app = express(); // express è una applicazione node.js minimale flessibile che fornisce
// un set di utilità per l'applicazione
const uuid = require('uuid');


// Messenger API parameters

// verifica se sono stati settati i parametri nel file di config
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
    throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
    throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
    throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
    throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}
if (!config.SENGRID_API_KEY) { //used for ink to static files
    throw new Error('missing SENGRID_API_KEY');
}
if (!config.EMAIL_FROM) { //used for ink to static files
    throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) { //used for ink to static files
    throw new Error('missing EMAIL_TO');
}

// viene settata la porta a 5000
app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature // questa funzione verifica che la request provenga dalla giusta applicazione ovvero facebook
}));

//serve static files in the public directory
// viene settata la folder 'public' come visibile (la folder contiene le risorse visibili all'esterni, 
//                                                 immagini, gif, video, etc..)
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
// utilizzo il modulo che aiuta ad effettuare il controllo sul body della request
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());


//verifica delle credenziali

const credentials = {
    client_email: config.GOOGLE_CLIENT_EMAIL,
    private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient({
    projectId: config.GOOGLE_PROJECT_ID,
    credentials
});


const sessionIds = new Map();

// Index route
app.get('/', function(req, res) {
    console.log("request");
    res.send('Hello world, I am a chat bot wich provide a dialog from Messenger interface')
})

// for Facebook verification
app.get('/webhook/', function(req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function(req, res) {

    var data = req.body;

    console.log(JSON.stringify(data));

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function(pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function(messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                    // i postback occorrono quando si preme su un PostbackButton, un Get Started Button, Persistent Menu o Structured Message è 'tapped'
                    // il payload è associato al pulsante ovvero al postback
                    // i postback in pratica vengono inviati quando l'utente clicca su un pulsante, su un elemento di un menu
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});





function receivedMessage(event) {

    var senderID = event.sender.id; // user che ha mandato il messaggio
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp; // timer del messaggio
    var message = event.message; // messaggio

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    // decommentati
    console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    var isEcho = message.is_echo; // verifica se il messaggio è un echo
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    // ora la parte più importante del messaggio
    // solo uno dei seguenti tre oggetti può arrivare valorizzato
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata); //al momento logga e basta
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to api.ai
        sendToDialogFlow(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleMessageAttachments(messageAttachments, senderID) {
    //for now just reply
    sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
    sendToDialogFlow(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleDialogFlowAction(sender, action, messages, contexts, parameters) {

    console.log("Inside handleDialogFlowAction, action is %s", action);

    if (contexts[0] != null) {
        console.log("contexts[0].name is %s", contexts[0].name);
        console.log("contexts[0].parameters is %s", contexts[0].parameters);

        if (contexts[0].parameters) {
            console.log("contexts[0].parameters == TRUE");
        } else {
            console.log("contexts[0].parameters == FALSE");
        }
    }

    console.log("**** Action pervenuta: $s", action);
    console.log("nome contesto(0): $s", contexts[0].name);

    switch (action) {
        case "actionRaccoltaDatiPrenotazione":
            if (isDefined(contexts[0]) &&(contexts[0].name.includes('fine_raccolta')) && contexts[0].parameters) {
                console.log("*** FINE RACCOLTA *** ");
                sendTypingOn(sender);

                //handleMessagesBis(messages, sender);

                sendTypingOff(sender);

                break;
            }

        case "verificaFarmaco":
            if (isDefined(contexts[0]) &&(contexts[0].name.includes('out_ricetta_no')) && contexts[0].parameters) {
            console.log("*** verificaFarmaco *** --> %s", contexts[0].parameters.fields['farmacoscelto'].stringValue);

            sendEventToDialogFlow(sender, "eventoCustom");

            sendTypingOn(sender);

            //handleMessagesBis(messages, sender);
            console.log("*** evento %s inviato", "eventoCustom");

            sendTypingOff(sender);

            break;
        }

        case "detailed-application":
            if (isDefined(contexts[0]) &&
                (contexts[0].name.includes('job-application') || contexts[0].name.includes('job-application-details_dialog_context') ||
                    contexts[0].name.includes('id_dialog_context')) &&
                contexts[0].parameters) {

                console.log("Settaggio variabili....");

                let phone_number = (isDefined(contexts[0].parameters.fields['phone-number']) &&
                    contexts[0].parameters.fields['phone-number'] != '') ? contexts[0].parameters.fields['phone-number'].stringValue : '';
                let user_name = (isDefined(contexts[0].parameters.fields['user-name']) &&
                    contexts[0].parameters.fields['user-name'] != '') ? contexts[0].parameters.fields['user-name'].stringValue : '';
                let previous_job = (isDefined(contexts[0].parameters.fields['previous-job']) &&
                    contexts[0].parameters.fields['previous-job'] != '') ? contexts[0].parameters.fields['previous-job'].stringValue : '';
                let years_of_experience = (isDefined(contexts[0].parameters.fields['years-of-experience']) &&
                    contexts[0].parameters.fields['years-of-experience'] != '') ? contexts[0].parameters.fields['years-of-experience'].stringValue : '';
                let job_vacancy = (isDefined(contexts[0].parameters.fields['job-vacancy']) &&
                    contexts[0].parameters.fields['job-vacancy'] != '') ? contexts[0].parameters.fields['job-vacancy'].stringValue : '';
                let email_user = (isDefined(contexts[0].parameters.fields['email_user']) &&
                    contexts[0].parameters.fields['email_user'] != '') ? contexts[0].parameters.fields['email_user'].stringValue : '';

                console.log('A new job enquiery from ' + user_name + '.<br> Previous job position: ' + previous_job + '.' +
                    '.<br> Years of experience: ' + years_of_experience + '.' +
                    '.<br> Phone number: ' + phone_number + '.' +
                    '.<br> email_user: ' + email_user + '.');

                if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != '' &&
                    email_user != ''
                ) {

                    let emailContent = 'A new job enquiery from ' + user_name + //' for the job: ' + job_vacancy +
                        '.<br> Previous job position: ' + previous_job + '.' +
                        '.<br> Years of experience: ' + years_of_experience + '.' +
                        '.<br> Phone number: ' + phone_number + '.';

                    console.log("Sending this mail: %s", emailContent);
                    sendEmail('New job application (from dialogflow!! :-) )', emailContent, email_user);

                    handleMessages(messages, sender);

                } else {
                    console.log("Non tutti i parametri settati");
                    //handleMessages(messages, sender);
                }
            }
            break;
        case "faq-spedizione":
            handleMessages(messages, sender);

            sendTypingOn(sender);

            setTimeout(() => {
                let buttons = [{
                        type: "web_url",
                        url: "https://www.google.com",
                        title: "Traccia la mia spedizione"
                    },
                    {
                        type: "phone_number",
                        title: "Chiamaci",
                        payload: "+393286457824"
                    },
                    {
                        type: "postback",
                        title: "informami sulla chat",
                        payload: "CHAT"
                    }

                ];
                sendButtonMessage(sender, "cosa vuoi fare adesso?", buttons);
            }, 3000); // aspetto 3 secondi
            break;
        default:
            //unhandled action, just send back the text

            //handleMessages(messages, sender);
    }
}

async function sendEventToDialogFlow(sender, eventName, params) {

    // è la funzione che realizza la request verso dialogflow

    sendTypingOn(sender); // questo chiede a Messenger di mostrare i puntini e il sound di attesa risposta... :-)

    try {
        // come prima cosa viene settata la sessione che consentirà a dialogFlow di tracciare le attività del particolare user (sender)
        console.log('config.GOOGLE_PROJECT_ID: %s', config.GOOGLE_PROJECT_ID);
        const sessionPath = sessionClient.sessionPath(config.GOOGLE_PROJECT_ID, sessionIds.get(sender));

        // costruiamo la Request da inviare a DialogFlow
        const request = {
            session: sessionPath,
            queryInput: {
                event: {
                    name: eventName,
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            }
        };

        // aspettiamo per una risposta da DialogFlow
        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        //console.log("Prima di handleDialogFlowResponse (dopo invio evento)");
        handleDialogFlowResponseBis(sender, result);
    } catch (e) {
        console.log('error');
        console.log(e);
    }

}

function sendEmail(subject, content_my, email_to) {

    var helper = require('sendgrid').mail;
    var fromEmail = new helper.Email(config.EMAIL_FROM);
    var toEmail = new helper.Email(email_to);
    console.log("Sending message email to: $s", email_to);
    var content = new helper.Content('text/plain', content_my);
    var mail = new helper.Mail(fromEmail, subject, toEmail, content);

    var sg = require('sendgrid')(config.SENGRID_API_KEY);
    var request = sg.emptyRequest({
        method: 'POST',
        path: '/v3/mail/send',
        body: mail.toJSON()
    });

    sg.API(request, function(error, response) {
        if (error) {
            console.log('Error response received');
        } else {
            console.log('***** OK send mail ************');
        }

        console.log(response.statusCode);
        console.log(response.body);
        console.log(response.headers);
    });

    /*

    console.log('sending email');
    var helper = require('sendgrid').mail;

    var from_email = new helper.Email(config.EMAIL_FROM);
    var to_email = new helper.Email(config.EMAIL_TO);
    var subject = subject;
    var content = new helper.Content("text/html", content);
    var mail = new helper.Mail(from_email, subject, to_email, content);

    var sg = require('sendgrid')(config.SENGRID_API_KEY);
    var request = sg.emptyRequest({
        method: 'POST',
        path: '/v3/mail/send',
        body: mail.toJSON()
    });

    sg.API(request, function(error, response) {
        console.log(response.statusCode)
        console.log(response.body)
        console.log(response.headers)
    })

    */
}

function handleMessage(message, sender) {
    console.log("chiamata a handleMessage");
    switch (message.message) {
        case "text": //text
            message.text.text.forEach((text) => {
                if (text !== '') {
                    console.log("ciclo interno a handleMessage, message: %s", text);
                    sendTextMessage(sender, text);
                }
            });
            break;
        case "quickReplies": //quick replies
            let replies = [];
            message.quickReplies.quickReplies.forEach((text) => {
                console.log("ciclo interno a handleMessage, message: %s", text);
                let reply = {
                    "content_type": "text",
                    "title": text,
                    "payload": text
                }
                replies.push(reply);
            });
            sendQuickReply(sender, message.quickReplies.title, replies);
            break;
        case "image": //image
            sendImageMessage(sender, message.image.imageUri);
            break;
    }
}

function handleMessageBis(message, sender) {
    console.log("chiamata a handleMessageBis");
    switch (message.message) {
        case "text": //text
            message.text.text.forEach((text) => {
                if (text !== '') {
                    console.log("ciclo interno a handleMessageBis, message: %s", text);
                    sendTextMessageBis(sender, text);
                }
            });
            break;
        case "quickReplies": //quick replies
            console.log("quickReplies dentro handleMessageBis");
            let replies = [];
            message.quickReplies.quickReplies.forEach((text) => {
                let reply = {
                    "content_type": "text",
                    "title": text,
                    "payload": text
                }
                replies.push(reply);
            });
            sendQuickReplyBis(sender, message.quickReplies.title, replies);
            break;
        case "image": //image
            sendImageMessage(sender, message.image.imageUri);
            break;
        default:
                console.log("default dentro handleMessageBis");
    }
}

function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.card.buttons.length; b++) {
            let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.card.buttons[b].text,
                    "url": message.card.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.card.buttons[b].text,
                    "payload": message.card.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.card.title,
            "image_url": message.card.imageUri,
            "subtitle": message.card.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleMessages(messages, sender) {
    let timeoutInterval = 1100;
    let previousType;
    let cardTypes = [];
    let timeout = 0;
    // si va in loop su tutti i messaggi ricevuti
    for (var i = 0; i < messages.length; i++) {

        if (previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            // il precedente è un card ma l'attuale non lo è, quindi è il momento di fare il display della gallery
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout); // dopo aver visualizzato la gallery gestisco l'attuale messaggio
            //(handleMessage gestisce tutti i messaggi di testo, immagini o quick-replies)
        } else if (messages[i].message == "card" && i == messages.length - 1) {
            // il messaggio, che è una card è l'ultimo dei messaggi, per cui è arrivato il momento di visualizzare la gallery
            cardTypes.push(messages[i]); // metto il messaggio nella card gallery
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if (messages[i].message == "card") {
            cardTypes.push(messages[i]); // metto il messaggio nella card gallery
        } else {
            // E' un messaggio di testo o un altro tipo di messaggio differente da "card"
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout); //handleMessage gestisce tutti i messaggi di testo, immagini o quick-replies
        }

        previousType = messages[i].message;

    }
}


function handleMessagesBis(messages, sender) {
    let timeoutInterval = 1100;
    let previousType;
    let cardTypes = [];
    let timeout = 0;
    // si va in loop su tutti i messaggi ricevuti
    for (var i = 0; i < messages.length; i++) {

        if (previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            // il precedente è un card ma l'attuale non lo è, quindi è il momento di fare il display della gallery
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessageBis.bind(null, messages[i], sender), timeout); // dopo aver visualizzato la gallery gestisco l'attuale messaggio
            //(handleMessage gestisce tutti i messaggi di testo, immagini o quick-replies)
        } else if (messages[i].message == "card" && i == messages.length - 1) {
            // il messaggio, che è una card è l'ultimo dei messaggi, per cui è arrivato il momento di visualizzare la gallery
            cardTypes.push(messages[i]); // metto il messaggio nella card gallery
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if (messages[i].message == "card") {
            cardTypes.push(messages[i]); // metto il messaggio nella card gallery
        } else {
            // E' un messaggio di testo o un altro tipo di messaggio differente da "card"
            timeout = i * timeoutInterval;
            setTimeout(handleMessageBis.bind(null, messages[i], sender), timeout); //handleMessage gestisce tutti i messaggi di testo, immagini o quick-replies
        }

        previousType = messages[i].message;

    }
}


function handleDialogFlowResponse(sender, response) {

    console.log("function handleDialogFlowResponse(sender, response)");

    // prendiamo quindi il text e il data
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    sendTypingOff(sender); //manda messaggio sonoro al messenger...

    if (isDefined(action)) {
        console.log("call handleDialogFlowAction");
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (isDefined(messages)) {
        console.log("call handleMessages");
        handleMessages(messages, sender); // mettendo BIS scrive il messaggio dell'evento
    } else if (responseText == '' && !isDefined(action)) {
        //dialogflow could not evaluate input --> non è stato inserito un Default Fallback Intent, quindi mando io un messaggio...
        console.log("sendTextMessage: %s", "I'm not sure what you want. Can you be more specific?");
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(responseText)) {
        console.log("sendTextMessage: %s", responseText);
        sendTextMessage(sender, responseText);
    }
}

function handleDialogFlowResponseBis(sender, response) {

    console.log("function handleDialogFlowResponseBis(sender, response)");

    // prendiamo quindi il text e il data
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    sendTypingOff(sender); //manda messaggio sonoro al messenger...

    if (isDefined(action)) {
        console.log("call handleDialogFlowAction");
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (isDefined(messages)) {
        console.log("call handleMessages");
        handleMessagesBis(messages, sender); 
    } else if (responseText == '' && !isDefined(action)) {
        //dialogflow could not evaluate input --> non è stato inserito un Default Fallback Intent, quindi mando io un messaggio...
        console.log("sendTextMessage: %s", "I'm not sure what you want. Can you be more specific?");
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(responseText)) {
        console.log("sendTextMessage: %s", responseText);
        sendTextMessage(sender, responseText);
    }
}

async function sendToDialogFlow(sender, textString, params) {

    // è la funzione che realizza la request verso dialogflow

    sendTypingOn(sender); // questo chiede a Messenger di mostrare i puntini e il sound di attesa risposta... :-)

    try {
        // come prima cosa viene settata la sessione che consentirà a dialogFlow di tracciare le attività del particolare user (sender)
        console.log('config.GOOGLE_PROJECT_ID: %s', config.GOOGLE_PROJECT_ID);
        const sessionPath = sessionClient.sessionPath(
            config.GOOGLE_PROJECT_ID,
            sessionIds.get(sender)
        );

        // costruiamo la Request da inviare a DialogFlow
        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: textString,
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            },
            queryParams: {
                payload: {
                    data: params
                }
            }
        };

        // aspettiamo per una risposta da DialogFlow
        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;

        // qui leggiamo la risposta di dialogFlow per vedere cosa ha trovato!!
        console.log("Prima di handleDialogFlowResponse");
        handleDialogFlowResponse(sender, result);
    } catch (e) {
        console.log('error');
        console.log(e);
    }

}

function sendTextMessage(recipientId, text) {
    console.log("sto mandando un messaggio al messenger, testo: %s", text);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }

    //callSendAPI(messageData); //duplicazione messaggi
}

function sendTextMessageBis(recipientId, text) {
    console.log("sto mandando un messaggio al messenger (bis), testo: %s", text);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }

    callSendAPI(messageData); //duplicazione messaggi
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };
    console.log("From sendImageMessage");
    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    console.log("From sendGif");
    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    console.log("From sendAudio");
    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };
    console.log("From sendVideo");
    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    console.log("From sendFile");
    callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    console.log("From sendButton");
    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };

    console.log("From sendGenericMessage");
    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
    timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    console.log("From sendReceiptMessage");
    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata) ? metadata : '',
            quick_replies: replies
        }
    };

    console.log("From sendQuickReply");
    //callSendAPI(messageData); //tolto per duplicazione messaggi...
}

function sendQuickReplyBis(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata) ? metadata : '',
            quick_replies: replies
        }
    };

    console.log("From sendQuickReply");
    //callSendAPI(messageData); //tolto per duplicazione messaggi...
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    console.log("From sendReadReceipt");
    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    console.log("From sendTypingOn");
    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    console.log("From typingOff");
    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };
    console.log("From sendAccountLinking");
    callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {

    console.log("callSendAPI, messageData: %s", messageData);

    request({
        uri: 'https://graph.facebook.com/v3.2/me/messages',
        qs: {
            access_token: config.FB_PAGE_TOKEN
        },
        method: 'POST',
        json: messageData

    }, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload; // il payload è associato al pulsante ovvero al postback

    switch (payload) {
        case "CHAT":
            sendTextMessage(senderID, "Anche a me piace chattare... altre domande?");
            break;
        case "JOB_APPLY":
            sendToDialogFlow(senderID, 'Sto cercando lavoro');
        default:
            //unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function(messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
})