const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const http = require('http');
const { VapiClient } = require('@vapi-ai/server-sdk');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Initialize Vapi client
const vapi = new VapiClient({
  token: process.env.VAPI_API_KEY || '7f93c00b-7bc9-4fd4-84fb-145affad6adc'
});

app.use(cors());
app.use(express.json());

// Store active meeting sessions
const activeSessions = new Map();

// Webhook endpoint for Vapi
app.post('/webhook/vapi', async (req, res) => {
  const { message } = req.body;
  
  console.log('Vapi webhook:', message.type);
  
  switch (message.type) {
    case 'status-update':
      io.emit('vapi-status', { status: message.call.status });
      break;
    case 'transcript':
      io.emit('vapi-transcript', {
        role: message.role,
        transcript: message.transcript
      });
      break;
    case 'function-call':
      return handleFunctionCall(message, res);
  }
  
  res.status(200).json({ received: true });
});

function handleFunctionCall(message, res) {
  const { functionCall } = message;
  
  switch (functionCall.name) {
    case 'generate_brainstorm_idea':
      const idea = generateBrainstormIdea(functionCall.parameters);
      return res.json({ result: idea });
    default:
      return res.status(400).json({ error: 'Unknown function' });
  }
}

function generateBrainstormIdea(parameters) {
  // This would be enhanced with actual AI logic
  const { context, topic } = parameters;
  return {
    idea: `Based on the discussion about ${topic}, consider exploring: innovative solutions that combine existing technologies in new ways.`,
    confidence: 0.85,
    timestamp: new Date().toISOString()
  };
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('zoom-meeting-joined', (data) => {
    console.log('Zoom meeting joined:', data.meetingId);
    activeSessions.set(socket.id, {
      meetingId: data.meetingId,
      joinedAt: new Date(),
      transcripts: []
    });
  });
  
  socket.on('meeting-transcript', (data) => {
    const session = activeSessions.get(socket.id);
    if (session) {
      session.transcripts.push(data);
      // Process transcript for context analysis
      analyzeConversationContext(data, socket);
    }
  });
  
  socket.on('request-brainstorm', async (data) => {
    try {
      const session = activeSessions.get(socket.id);
      if (session) {
        // Use Vapi to generate brainstorming ideas
        await triggerVapiBrainstorm(data.context, socket);
      }
    } catch (error) {
      console.error('Error generating brainstorm:', error);
      socket.emit('brainstorm-error', { error: error.message });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeSessions.delete(socket.id);
  });
});

async function analyzeConversationContext(transcript, socket) {
  // Analyze conversation for mind blocks or brainstorming opportunities
  const keywords = ['stuck', 'ideas', 'brainstorm', 'think', 'problem', 'solution'];
  const hasKeywords = keywords.some(keyword => 
    transcript.text.toLowerCase().includes(keyword)
  );
  
  if (hasKeywords) {
    socket.emit('brainstorm-opportunity', {
      suggestion: 'It seems like the team could benefit from some brainstorming assistance.',
      transcript: transcript
    });
  }
}

async function triggerVapiBrainstorm(context, socket) {
  // Create a Vapi assistant call for brainstorming
  try {
    const assistant = await vapi.assistants.create({
      name: "Brainstorm Assistant",
      firstMessage: "I'm here to help generate creative ideas for your meeting discussion.",
      model: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.8,
        messages: [{
          role: "system",
          content: `You are a creative brainstorming assistant. Your role is to listen to meeting context and generate innovative, practical ideas to help overcome creative blocks. Focus on:
          - Creative problem-solving approaches
          - Alternative perspectives
          - Combining existing ideas in new ways
          - Practical next steps
          Keep responses concise and actionable.`
        }]
      },
      voice: {
        provider: "11labs",
        voiceId: "21m00Tcm4TlvDq8ikWAM"
      },
      tools: [{
        type: "function",
        function: {
          name: "generate_brainstorm_idea",
          description: "Generate creative brainstorming ideas based on meeting context",
          parameters: {
            type: "object",
            properties: {
              context: { type: "string" },
              topic: { type: "string" }
            }
          }
        }
      }]
    });
    
    socket.emit('vapi-assistant-ready', { assistantId: assistant.id });
  } catch (error) {
    console.error('Error creating Vapi assistant:', error);
    throw error;
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});