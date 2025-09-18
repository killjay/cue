# Zoom + Vapi.ai Brainstorm Assistant

An AI-powered brainstorming assistant that integrates with Zoom meetings to provide real-time creative ideas and overcome mind blocks during team discussions.

## Features

- **Zoom Meeting Integration**: Connect to Zoom meetings and listen to conversations in real-time
- **AI-Powered Brainstorming**: Uses Vapi.ai voice assistant to generate creative ideas based on meeting context
- **Real-time Transcription**: Captures and analyzes meeting conversations for brainstorming opportunities
- **Mind Block Detection**: Automatically detects when teams might benefit from brainstorming assistance
- **Idea Sharing**: Broadcast AI-generated ideas to all meeting participants
- **Voice Interaction**: Natural voice conversation with the AI assistant

## Architecture

- **Frontend**: React.js application with Zoom Web SDK and Vapi.ai Web SDK
- **Backend**: Node.js server with Express, Socket.io for real-time communication
- **AI Integration**: Vapi.ai for voice AI capabilities and brainstorming logic
- **Meeting Integration**: Zoom Web SDK for meeting connectivity and audio access

## Prerequisites

Before setting up the application, you'll need:

1. **Zoom App Credentials**:
   - Zoom API Key and Secret
   - Create a Zoom App at [Zoom Marketplace](https://marketplace.zoom.us/)

2. **Vapi.ai Account**:
   - Vapi.ai API Key: `7f93c00b-7bc9-4fd4-84fb-145affad6adc`
   - Create assistants and configure voice models

## Installation

1. **Clone and install dependencies**:
   ```bash
   npm run install-all
   ```

2. **Configure environment variables**:
   Create a `.env` file in the root directory:
   ```env
   VAPI_API_KEY=7f93c00b-7bc9-4fd4-84fb-145affad6adc
   ZOOM_API_KEY=your_zoom_api_key
   ZOOM_API_SECRET=your_zoom_api_secret
   PORT=3001
   ```

3. **Update client configuration**:
   In `client/src/App.js`, replace the placeholder values:
   ```javascript
   const vapi = new Vapi('YOUR_VAPI_PUBLIC_KEY');
   // Update with your actual Vapi.ai public key
   
   // In joinZoomMeeting function:
   apiKey: 'YOUR_ZOOM_API_KEY'
   // Update with your actual Zoom API key
   ```

## Usage

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

3. **Connect to a Zoom meeting**:
   - Enter your Zoom meeting ID and password
   - Click "Join Meeting" to connect

4. **Start AI brainstorming**:
   - Click "Start Brainstorming" to activate the voice assistant
   - The AI will listen to the conversation and provide suggestions
   - Click "Share with Meeting" to broadcast ideas to participants

## Configuration

### Vapi.ai Assistant Setup

The application creates a brainstorming assistant with the following configuration:

- **Model**: GPT-4 with high creativity (temperature: 0.8)
- **Voice**: ElevenLabs voice for natural speech
- **System Prompt**: Optimized for creative problem-solving and brainstorming
- **Tools**: Custom function for generating contextual ideas

### Zoom Integration

The app uses Zoom Web SDK to:
- Join meetings programmatically
- Access real-time audio streams
- Send messages to meeting chat (future enhancement)

## API Endpoints

### Server Endpoints

- `POST /webhook/vapi` - Webhook for Vapi.ai events
- WebSocket events:
  - `zoom-meeting-joined` - Notify server of meeting connection
  - `meeting-transcript` - Send transcript data for analysis
  - `request-brainstorm` - Trigger AI brainstorming session

## Development

### Project Structure

```
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.js         # Main application component
│   │   ├── App.css        # Styles
│   │   └── index.js       # Entry point
│   └── package.json
├── server/                 # Node.js backend
│   └── index.js           # Express server with Socket.io
├── .env                   # Environment variables
├── package.json          # Root package.json
└── README.md
```

### Key Components

1. **ZoomIntegration**: Handles Zoom SDK initialization and meeting connection
2. **VapiClient**: Manages Vapi.ai voice assistant interactions
3. **TranscriptAnalyzer**: Processes conversation for brainstorming opportunities
4. **IdeaBroadcaster**: Shares AI-generated ideas with meeting participants

## Security Considerations

- **JWT Signatures**: Zoom meeting signatures should be generated server-side
- **API Keys**: Never expose API secrets in client-side code
- **Environment Variables**: Use proper environment variable management
- **CORS**: Configure CORS properly for production deployment

## Deployment

For production deployment:

1. **Build the client**:
   ```bash
   npm run build
   ```

2. **Deploy to cloud platform** (Heroku, Vercel, AWS, etc.)

3. **Configure production environment variables**

4. **Set up proper domain and SSL certificates**

## Troubleshooting

### Common Issues

1. **Zoom SDK Loading**: Ensure Zoom SDK assets are properly loaded
2. **Vapi.ai Connection**: Verify API keys and assistant configuration
3. **Audio Permissions**: Browser must grant microphone access
4. **CORS Issues**: Check server CORS configuration for cross-origin requests

### Debug Mode

Enable debug logging by setting:
```javascript
console.log('Debug mode enabled');
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions:
- Check the [Zoom SDK Documentation](https://developers.zoom.us/docs/)
- Review [Vapi.ai Documentation](https://docs.vapi.ai/)
- Create an issue in this repository