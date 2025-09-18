import React, { useState, useEffect, useCallback } from 'react';
import zoomSdk from '@zoom/appssdk';
import Vapi from '@vapi-ai/web';
import io from 'socket.io-client';
import './App.css';

// Initialize Vapi client with environment variable
const vapi = new Vapi(process.env.REACT_APP_VAPI_PUBLIC_KEY || '4e22bf06-bde8-4fe4-bcc0-e832850501ee');

// Brainstorming assistant configuration
const BRAINSTORM_ASSISTANT = {
  model: {
    provider: "openai",
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `You are an AI brainstorming assistant for Zoom meetings. Your role is to:
        
        1. LISTEN to meeting conversations and detect when participants need creative ideas
        2. ANALYZE discussion context to understand the brainstorming topic
        3. GENERATE creative, actionable suggestions when asked
        4. RESPOND with 2-3 concise brainstorming ideas
        5. ENGAGE naturally in the conversation flow
        
        Key behaviors:
        - Wait for explicit requests like "give us ideas", "help brainstorm", "what do you think"
        - Detect silence or "stuck" moments in creative discussions  
        - Provide diverse, creative solutions
        - Keep responses under 30 seconds
        - Ask clarifying questions when context is unclear
        
        You're here to fill mind blocks and spark creativity!`
      }
    ]
  },
  voice: {
    provider: "11labs",
    voiceId: "burt"
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en"
  }
};

function App() {
  const [isZoomConfigured, setIsZoomConfigured] = useState(false);
  const [isMeetingConnected, setIsMeetingConnected] = useState(false);
  const [isVapiConnected, setIsVapiConnected] = useState(false);
  const [meetingTranscripts, setMeetingTranscripts] = useState([]);
  const [brainstormSuggestions, setBrainstormSuggestions] = useState([]);
  const [socket, setSocket] = useState(null);
  const [meetingContext, setMeetingContext] = useState(null);
  const [userContext, setUserContext] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [runningContext, setRunningContext] = useState('');
  const [supportedApis, setSupportedApis] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [conversationBuffer, setConversationBuffer] = useState([]);
  const [lastSpeakTime, setLastSpeakTime] = useState(Date.now());

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('brainstorm-opportunity', (data) => {
      setBrainstormSuggestions(prev => [...prev, data]);
    });

    newSocket.on('vapi-assistant-ready', (data) => {
      console.log('Vapi assistant ready:', data.assistantId);
    });

    newSocket.on('vapi-transcript', (data) => {
      console.log('Vapi transcript:', data);
    });

    return () => newSocket.close();
  }, []);

  // Initialize Zoom Apps SDK
  useEffect(() => {
    const configureZoomApp = async () => {
      try {
        const configResponse = await zoomSdk.config({
          capabilities: [
            // Core APIs
            "getMeetingContext",
            "getUserContext", 
            "getMeetingParticipants",
            "sendMessageToChat",
            "onActiveSpeakerChange",
            "onMyActiveSpeakerChange",
            "onParticipantChange",
            "onMessage",
            "sendMessage",
            "connect",
            "postMessage",
            
            // Meeting actions
            "setAudioState",
            "getAudioState",
            "setVideoState", 
            "getVideoState",
            "onMyMediaChange",
            
            // Sharing and UI
            "shareApp",
            "onShareApp",
            "expandApp",
            "showNotification",
            "sendAppInvitationToAllParticipants",
            
            // Real-time features
            "startRTMS",
            "stopRTMS",
            "getRTMSStatus",
            "onRTMSStatusChange"
          ]
        });

        console.log('Zoom SDK configured:', configResponse);
        setIsZoomConfigured(true);
        setRunningContext(configResponse.runningContext);
        
        // Get supported APIs
        const supportedResponse = await zoomSdk.getSupportedJsApis();
        setSupportedApis(supportedResponse.supportedApis);
        
        // Check if we're in a meeting
        if (configResponse.runningContext === 'inMeeting') {
          console.log('✅ Detected inMeeting context, initializing meeting features...');
          try {
            await initializeMeetingFeatures();
            console.log('✅ Meeting features initialized successfully');
          } catch (meetingError) {
            console.error('❌ Failed to initialize meeting features:', meetingError);
            setRunningContext('inMeeting (Meeting API Error)');
          }
        } else {
          // Set demo mode when not in meeting
          setRunningContext('Demo Mode - Not in Zoom Meeting');
          console.log('App loaded outside Zoom meeting - limited functionality');
        }
        
      } catch (error) {
        console.error('Failed to configure Zoom SDK:', error);
      }
    };

    configureZoomApp();
  }, []);

  // Initialize meeting-specific features
  const initializeMeetingFeatures = async () => {
    try {
      console.log('🔧 Starting meeting features initialization...');
      
      // Get meeting context
      console.log('📋 Getting meeting context...');
      const meetingContextResponse = await zoomSdk.getMeetingContext();
      console.log('📋 Meeting context response:', meetingContextResponse);
      setMeetingContext(meetingContextResponse);
      setIsMeetingConnected(true);
      
      // Get user context
      console.log('👤 Getting user context...');
      const userContextResponse = await zoomSdk.getUserContext();
      console.log('👤 User context response:', userContextResponse);
      setUserContext(userContextResponse);
      
      // Get meeting participants (if host/co-host)
      if (userContextResponse.role === 'host' || userContextResponse.role === 'coHost') {
        const participantsResponse = await zoomSdk.getMeetingParticipants();
        setParticipants(participantsResponse.participants);
      }
      
      // Set up event listeners
      setupZoomEventListeners();
      
      // Connect for app-to-app communication
      try {
        await zoomSdk.connect();
        console.log('Connected for app communication');
      } catch (error) {
        console.log('App communication not available:', error);
      }
      
      // Notify server about meeting connection
      if (socket) {
        socket.emit('zoom-meeting-joined', {
          meetingId: meetingContextResponse.meetingID,
          meetingTopic: meetingContextResponse.meetingTopic
        });
      }
      
    } catch (error) {
      console.error('Failed to initialize meeting features:', error);
    }
  };

  // Setup Zoom event listeners
  const setupZoomEventListeners = () => {
    // Listen for participant changes
    zoomSdk.onParticipantChange((event) => {
      console.log('Participant change:', event);
      // Update participants list if we have permission
      if (userContext?.role === 'host' || userContext?.role === 'coHost') {
        zoomSdk.getMeetingParticipants().then(response => {
          setParticipants(response.participants);
        });
      }
    });

    // Listen for active speaker changes
    zoomSdk.onActiveSpeakerChange((event) => {
      console.log('Active speaker change:', event);
      // Could use this to focus on current speaker for transcription
    });

    // Listen for when user starts/stops speaking
    zoomSdk.onMyActiveSpeakerChange((event) => {
      console.log('My speaking status:', event);
      if (event.action === 'start') {
        // User started speaking - could trigger transcription
      }
    });

    // Listen for app messages (for multi-participant communication)
    zoomSdk.onMessage((event) => {
      console.log('Received app message:', event);
      // Handle messages from other app instances
      if (event.payload) {
        // Process brainstorming messages from other participants
        handleAppMessage(event.payload);
      }
    });

    // Listen for media changes
    zoomSdk.onMyMediaChange((event) => {
      console.log('Media change:', event);
      // React to audio/video state changes
    });

    // Listen for RTMS status changes (for real-time transcription)
    zoomSdk.onRTMSStatusChange((event) => {
      console.log('RTMS status change:', event);
      // Handle real-time transcription status
    });
  };

  // Handle messages from other app instances
  const handleAppMessage = (payload) => {
    if (payload.type === 'brainstorm_idea') {
      setBrainstormSuggestions(prev => [...prev, {
        suggestion: payload.idea,
        from: payload.from,
        timestamp: payload.timestamp
      }]);
    } else if (payload.type === 'transcript') {
      setMeetingTranscripts(prev => [...prev, {
        role: payload.role,
        text: payload.text,
        timestamp: payload.timestamp
      }]);
    }
  };

  // Initialize Vapi event listeners
  useEffect(() => {
    vapi.on('call-start', () => {
      console.log('Vapi call started');
      setIsVapiConnected(true);
    });

    vapi.on('call-end', () => {
      console.log('Vapi call ended');
      setIsVapiConnected(false);
    });

    vapi.on('message', (message) => {
      if (message.type === 'transcript') {
        console.log(`${message.role}: ${message.transcript}`);
        
        const transcript = {
          role: message.role,
          text: message.transcript,
          timestamp: new Date().toISOString()
        };
        
        setMeetingTranscripts(prev => [...prev, transcript]);

        // Send transcript to server for analysis
        if (socket) {
          socket.emit('meeting-transcript', transcript);
        }

        // Broadcast transcript to other app instances
        if (isMeetingConnected) {
          zoomSdk.sendMessage({
            type: 'transcript',
            ...transcript
          }).catch(error => console.log('Failed to broadcast transcript:', error));
        }
      }
    });

    return () => {
      vapi.stop();
    };
  }, [socket, isMeetingConnected]);

  // Setup conversation monitoring for brainstorming triggers
  const setupConversationMonitoring = () => {
    console.log('🔍 Setting up conversation monitoring...');
    
    // Setup Vapi event listeners for conversation flow
    vapi.on('speech-start', () => {
      console.log('🗣️ Speech detected');
    });
    
    vapi.on('speech-end', () => {
      console.log('🔇 Speech ended');
      setLastSpeakTime(Date.now());
    });
    
    vapi.on('transcript', (transcript) => {
      console.log('📝 Transcript:', transcript);
      
      // Add to conversation buffer
      const newMessage = {
        text: transcript.text,
        speaker: transcript.user || 'Participant',
        timestamp: Date.now()
      };
      
      setConversationBuffer(prev => {
        const updated = [...prev, newMessage];
        // Keep only last 10 messages
        return updated.slice(-10);
      });
      
      // Check for brainstorming triggers
      checkForBrainstormingTriggers(transcript.text);
    });
    
    vapi.on('message', (message) => {
      console.log('💬 Vapi message:', message);
      
      // If Vapi generated a brainstorming response, share it with the meeting
      if (message.type === 'assistant-message' && isMeetingConnected) {
        shareBrainstormIdea(message.content);
      }
    });
  };

  // Check if conversation contains brainstorming triggers
  const checkForBrainstormingTriggers = (text) => {
    const brainstormTriggers = [
      'stuck', 'blocked', 'ideas', 'brainstorm', 'think', 'suggest',
      'help', 'creative', 'solution', 'problem', 'challenge', 'what if',
      'how can we', 'any thoughts', 'opinions', 'feedback'
    ];
    
    const lowerText = text.toLowerCase();
    const hasTrigger = brainstormTriggers.some(trigger => lowerText.includes(trigger));
    
    if (hasTrigger) {
      console.log('🧠 Brainstorming trigger detected in:', text);
      
      // Add context to Vapi for response generation
      const contextMessage = `Context: "${text}" - Please provide creative brainstorming ideas.`;
      
      // Send context to Vapi for processing
      if (isVapiConnected) {
        vapi.send({
          type: 'add-message',
          message: {
            role: 'user',
            content: contextMessage
          }
        });
      }
    }
  };

  // Share brainstorming idea with meeting participants
  const shareBrainstormIdea = async (idea) => {
    try {
      console.log('💡 Sharing brainstorm idea:', idea);
      
      if (isMeetingConnected && zoomSdk) {
        // Send message to Zoom chat
        await zoomSdk.sendMessage({
          message: `🧠 AI Brainstorm: ${idea}`,
          userId: 'all'
        });
        
        console.log('✅ Brainstorm idea shared with meeting');
      }
    } catch (error) {
      console.error('❌ Failed to share brainstorm idea:', error);
    }
  };

  // Start Vapi brainstorming session with conversation listening
  const startVapiBrainstorm = async () => {
    try {
      console.log('🎤 Starting Vapi.ai brainstorming session...');
      
      // Start Vapi call with brainstorming assistant
      await vapi.start(process.env.REACT_APP_VAPI_ASSISTANT_ID || 'a4881746-c6ba-4399-a6ce-03b2183168ca', {
        ...BRAINSTORM_ASSISTANT,
        recordingEnabled: false,
        variableValues: {
          meetingTopic: meetingContext?.meetingTopic || 'General Discussion',
          participantCount: participants.length,
          userName: userContext?.screenName || 'User'
        }
      });
      
      setIsVapiConnected(true);
      setIsListening(true);
      console.log('✅ Vapi brainstorming session started');
      
      // Setup conversation monitoring
      setupConversationMonitoring();
      
      // Show notification to meeting participants
      if (isMeetingConnected) {
        await zoomSdk.showNotification({
          type: 'info',
          title: 'AI Brainstorm Assistant',
          message: 'AI is now listening and ready to help brainstorm ideas!',
          duration: 5000
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to start Vapi brainstorming:', error);
    }
  };

  // Stop Vapi brainstorming session
  const stopVapiBrainstorm = () => {
    try {
      console.log('⏹️ Stopping Vapi.ai brainstorming session...');
      vapi.stop();
      setIsVapiConnected(false);
      setIsListening(false);
      console.log('✅ Vapi session stopped');
    } catch (error) {
      console.error('❌ Failed to stop Vapi session:', error);
    }
  };

  // Send brainstorming idea to all meeting participants
  const sendIdeaToMeeting = async (idea) => {
    try {
      if (!isMeetingConnected) {
        console.log('Not connected to meeting');
        return;
      }

      // Send via Zoom chat
      await zoomSdk.sendMessageToChat({
        message: `💡 AI Brainstorm Idea: ${idea.suggestion}`,
        channel: 'meeting'
      });

      // Also broadcast to other app instances
      await zoomSdk.sendMessage({
        type: 'brainstorm_idea',
        idea: idea.suggestion,
        from: userContext?.screenName || 'AI Assistant',
        timestamp: new Date().toISOString()
      });

      console.log('Idea sent to meeting:', idea);
    } catch (error) {
      console.error('Error sending idea to meeting:', error);
      // Fallback: show notification
      await zoomSdk.showNotification({
        type: 'info',
        title: 'Brainstorm Idea',
        message: idea.suggestion,
        duration: 10000
      });
    }
  };

  // Start real-time transcription using Zoom's RTMS
  const startRealTimeTranscription = async () => {
    try {
      if (supportedApis.includes('startRTMS')) {
        await zoomSdk.startRTMS();
        console.log('Real-time transcription started');
      } else {
        console.log('RTMS not supported in current context');
      }
    } catch (error) {
      console.error('Failed to start RTMS:', error);
    }
  };

  // Stop real-time transcription
  const stopRealTimeTranscription = async () => {
    try {
      if (supportedApis.includes('stopRTMS')) {
        await zoomSdk.stopRTMS();
        console.log('Real-time transcription stopped');
      }
    } catch (error) {
      console.error('Failed to stop RTMS:', error);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🧠 Zoom + Vapi.ai Brainstorm Assistant</h1>
        <p>AI-powered brainstorming for your Zoom meetings</p>
      </header>

      <main className="App-main">
        {/* Connection Status Section */}
        <section className="status-section">
          <h2>Connection Status</h2>
          <div className="status">
            <span className={`status-indicator ${isZoomConfigured ? 'connected' : 'disconnected'}`}>
              Zoom SDK: {isZoomConfigured ? 'Configured' : 'Not Configured'}
            </span>
            <span className={`status-indicator ${isMeetingConnected ? 'connected' : 'disconnected'}`}>
              Meeting: {isMeetingConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span className={`status-indicator ${isVapiConnected ? 'connected' : 'disconnected'}`}>
              Vapi.ai: {isVapiConnected ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="context-info">
            <p><strong>Running Context:</strong> {runningContext}</p>
            {!isMeetingConnected && runningContext.includes('Demo') && (
              <div className="demo-notice">
                <p>⚠️ <strong>Demo Mode:</strong> For full functionality, install this app in Zoom and launch it during a meeting.</p>
                <p>📱 <strong>To test properly:</strong></p>
                <ol>
                  <li>Update your Zoom App configuration with this URL</li>
                  <li>Start a Zoom meeting</li>
                  <li>Click "Apps" in the meeting toolbar</li>
                  <li>Launch your AI Brainstorm Assistant</li>
                </ol>
              </div>
            )}
            {userContext && (
              <p><strong>User:</strong> {userContext.screenName} ({userContext.role})</p>
            )}
            {meetingContext && (
              <p><strong>Meeting:</strong> {meetingContext.meetingTopic}</p>
            )}
          </div>
        </section>

        {/* Meeting Information */}
        {isMeetingConnected && (
          <section className="meeting-info">
            <h3>Meeting Details</h3>
            <div className="meeting-details">
              <p><strong>Meeting ID:</strong> {meetingContext?.meetingID}</p>
              <p><strong>Topic:</strong> {meetingContext?.meetingTopic}</p>
              <p><strong>Participants:</strong> {participants.length}</p>
              {participants.length > 0 && (
                <div className="participants-list">
                  {participants.slice(0, 5).map((participant, index) => (
                    <span key={index} className="participant-tag">
                      {participant.screenName}
                    </span>
                  ))}
                  {participants.length > 5 && <span>+{participants.length - 5} more</span>}
                </div>
              )}
            </div>
          </section>
        )}

        {/* AI Assistant Controls */}
        <section className="assistant-section">
          <h2>AI Brainstorm Assistant</h2>
          <div className="assistant-controls">
            <button 
              onClick={startVapiBrainstorm}
              disabled={!isMeetingConnected || isVapiConnected}
              className="talk-button"
            >
              🎤 Start Brainstorming
            </button>
            <button 
              onClick={stopVapiBrainstorm}
              disabled={!isVapiConnected}
              className="stop-button"
            >
              ⏹️ Stop Assistant
            </button>
          </div>
          
          {/* Transcription Controls */}
          <div className="transcription-controls">
            <button 
              onClick={startRealTimeTranscription}
              disabled={!isMeetingConnected || !supportedApis.includes('startRTMS')}
              className="feature-button"
            >
              📝 Start Live Transcription
            </button>
            <button 
              onClick={stopRealTimeTranscription}
              disabled={!isMeetingConnected || !supportedApis.includes('stopRTMS')}
              className="feature-button"
            >
              ⏸️ Stop Transcription
            </button>
          </div>
        </section>

        {/* Meeting Transcripts */}
        <section className="transcripts-section">
          <h3>Meeting Conversation</h3>
          <div className="transcripts">
            {meetingTranscripts.slice(-10).map((transcript, index) => (
              <div key={index} className={`transcript ${transcript.role}`}>
                <span className="role">{transcript.role}:</span>
                <span className="text">{transcript.text}</span>
                <span className="time">{new Date(transcript.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
            {meetingTranscripts.length === 0 && (
              <p className="empty-state">No transcripts yet. Start the AI assistant to begin capturing conversations.</p>
            )}
          </div>
        </section>

        {/* Brainstorm Suggestions */}
        <section className="suggestions-section">
          <h3>AI Brainstorm Suggestions</h3>
          <div className="suggestions">
            {brainstormSuggestions.map((suggestion, index) => (
              <div key={index} className="suggestion">
                <p>{suggestion.suggestion}</p>
                {suggestion.from && (
                  <small className="suggestion-meta">From: {suggestion.from}</small>
                )}
                <button 
                  onClick={() => sendIdeaToMeeting(suggestion)}
                  className="share-button"
                  disabled={!isMeetingConnected}
                >
                  💡 Share with Meeting
                </button>
              </div>
            ))}
            {brainstormSuggestions.length === 0 && (
              <p className="empty-state">No brainstorm suggestions yet. Start the AI assistant to generate ideas.</p>
            )}
          </div>
        </section>

        {/* Debug Information */}
        {process.env.NODE_ENV === 'development' && (
          <section className="debug-section">
            <h3>Debug Information</h3>
            <details>
              <summary>Supported APIs ({supportedApis.length})</summary>
              <ul className="api-list">
                {supportedApis.map((api, index) => (
                  <li key={index}>{api}</li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;