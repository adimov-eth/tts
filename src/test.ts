import { config } from 'dotenv';
import { OpenAIService } from './openaiService';
import { ElevenLabsService } from './elevenService';
import * as fs from 'fs/promises';

// Load environment variables
config();

const {
    OPENAI_API_KEY,
    ELEVENLABS_API_KEY
} = process.env;

if (!OPENAI_API_KEY || !ELEVENLABS_API_KEY) {
    console.error('Missing required environment variables');
    process.exit(1);
}

// After the check above, TypeScript knows these are not undefined
const openAIKey = OPENAI_API_KEY;
const elevenLabsKey = ELEVENLABS_API_KEY;

async function testOpenAI() {
    console.log('\n🧪 Testing OpenAI Service...');
    const openAI = new OpenAIService(openAIKey);
    
    try {
        const result = await openAI.transformText('hello world, this is a test');
        console.log('✅ OpenAI Response:', result);
    } catch (error) {
        console.error('❌ OpenAI Test Failed:', error);
    }
}

async function testElevenLabs() {
    console.log('\n🧪 Testing ElevenLabs Service...');
    const elevenLabs = new ElevenLabsService(elevenLabsKey);
    
    try {
        // Test getting voices
        console.log('Testing getVoices...');
        const voices = await elevenLabs.getVoices();
        console.log('✅ Available voices:', voices.voices.length);

        // Test speech generation
        console.log('Testing speech generation...');
        const audioBuffer = await elevenLabs.generateSpeech('Hello! This is a test of the text to speech system.');
        
        // Save the audio file
        const testFile = 'test-output.mp3';
        await fs.writeFile(testFile, audioBuffer);
        console.log(`✅ Speech generated and saved to ${testFile}`);
    } catch (error) {
        console.error('❌ ElevenLabs Test Failed:', error);
    }
}

async function runTests() {
    console.log('🚀 Starting Tests...');
    
    await testOpenAI();
    await testElevenLabs();
    
    console.log('\n✨ Tests completed!');
}

// Run the tests
runTests().catch(console.error); 