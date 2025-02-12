require("dotenv").config({ path: __dirname + "/.env" });
const Microphone = require("node-microphone");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const readline = require("readline");
const axios = require("axios");
const FormData = require("form-data");
const { exec } = require("child_process");

ffmpeg.setFfmpegPath(ffmpegPath);

// Load API keys from .env
if (!process.env.OPENAI_API_KEY || !process.env.ELEVENLABS_API_KEY || !process.env.CHATBASE_API_KEY || !process.env.CHATBASE_BOT_ID) {
    console.error("❌ Error: Missing API keys. Check your .env file.");
    process.exit(1);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY;
const CHATBASE_BOT_ID = process.env.CHATBASE_BOT_ID;

let mic, outputFile, micStream, rl;

// Voice options from Eleven Labs
const voiceOptions = {
    "1": { id: "fEVT2ExfHe1MyjuiIiU9", name: "Aaron Clone" },
    "2": { id: "PBRZNehukS2osoqNNVE6", name: "Päivi Clone" },
    "3": { id: "DOuMHikmQrfy8aqpSPDm", name: "Junior Clone" },
    "4": { id: "H6gqdwMY6LgPHPoYlaL1", name: "Pekka Clone" },
    "5": { id: "VJPdWR5GhEdG6LxWu8AS", name: "George Clone" },
    "6": { id: "9BWtsMINqrJLrRacOk9x", name: "Aria (General)" },
    "7": { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah (General)" },
    "8": { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger (General)" },
    "9": { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura (General)" },
    "10": { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum (General)" }
};

let selectedVoiceID = voiceOptions["1"].id; // Default voice

// Setup readline interface for user input
const setupReadlineInterface = () => {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    console.log("\n# Welcome to your AI-powered voice chat #\n");
    console.log("🎤 Available Voices:");
    for (const [key, voice] of Object.entries(voiceOptions)) {
        console.log(`${key}: ${voice.name}`);
    }

    rl.question("Select a voice by number (default: 1): ", (answer) => {
        if (voiceOptions[answer]) {
            selectedVoiceID = voiceOptions[answer].id;
            console.log(`✅ Selected voice: ${voiceOptions[answer].name}`);
        } else {
            console.log("⚠️ Invalid selection, using default voice.");
        }
        console.log("🎤 Voice selection complete. Press Enter to start speaking.");
        process.stdin.once("data", () => startRecording());
    });
};

// Start recording user voice input
const startRecording = () => {
    mic = new Microphone();
    outputFile = fs.createWriteStream("output.wav");
    micStream = mic.startRecording();

    micStream.on("data", (data) => outputFile.write(data));
    micStream.on("error", (error) => console.error("Microphone Error:", error));

    console.log("🎤 Recording... Press Enter to stop");
    process.stdin.once("data", stopRecordingAndProcess);
};

// Stop recording and process the audio file
const stopRecordingAndProcess = () => {
    mic.stopRecording();
    outputFile.end();
    console.log("✅ Recording stopped, processing audio...");
    setTimeout(() => transcribeAndChat(), 1000); // Delay to ensure file is saved
};

// Function to send the user's text input to Chatbase and get AI response
async function getChatResponse(userInput) {
    try {
        const response = await axios.post(
            "https://www.chatbase.co/api/v1/chat",
            {
                messages: [{ role: "user", content: userInput }],
                chatbotId: CHATBASE_BOT_ID
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${CHATBASE_API_KEY}`
                },
            }
        );

        // Debugging: Print full Chatbase API response
        console.log("🔍 Chatbase API Response:", JSON.stringify(response.data, null, 2));

        // Check if response contains the 'text' field
        if (response.data && response.data.text) {
            return response.data.text; // Corrected to return the actual chatbot response
        } else {
            console.error("❌ Chatbase API Error: No valid text response received.");
            return "Sorry, I couldn't process your request.";
        }
    } catch (error) {
        console.error("❌ Chatbase API Error:", error.response?.data || error.message);
        return "Sorry, I couldn't process your request.";
    }
}

// Convert AI-generated text into speech using Eleven Labs
async function generateSpeech(text) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceID}`;
    try {
        const response = await axios.post(url, { text, model_id: "eleven_turbo_v2" }, {
            headers: { "xi-api-key": ELEVENLABS_API_KEY }, responseType: "arraybuffer" 
        });

        fs.writeFileSync("output.mp3", response.data);
        console.log("🔊 Audio generated. Playing now...");

        setTimeout(() => {
            exec("ffplay -nodisp -autoexit output.mp3", (error) => {
                if (error) console.error("FFmpeg play error:", error);
                askToContinue();
            });
        }, 500);
    } catch (error) {
        console.error("ElevenLabs API Error:", error.response?.data || error.message);
        askToContinue();
    }
}

// Ask user if they want to continue speaking
const askToContinue = () => {
    console.log("Press Enter to speak again, or any other key to quit.");
    process.stdin.once("data", (data) => {
        if (data.toString().trim() === "") {
            startRecording();
        } else {
            console.log("Goodbye!");
            process.exit(0);
        }
    });
};

// Transcribe recorded speech to text using OpenAI Whisper API and get AI response
async function transcribeAndChat() {
    const filePath = "output.wav";
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-1");

    try {
        const transcriptionResponse = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` },
        });

        const transcribedText = transcriptionResponse.data.text || transcriptionResponse.data;
        console.log(`>> You said: ${transcribedText}`);

        const chatResponseText = await getChatResponse(transcribedText);
        console.log(`>> Assistant said: ${chatResponseText}`);

        generateSpeech(chatResponseText);
    } catch (error) {
        console.error("Error processing audio:", error.message);
        askToContinue();
    }
}

setupReadlineInterface();
