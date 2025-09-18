import React, { useState, useEffect, useCallback } from 'react';
import zoomSdk from '@zoom/appssdk';
import Vapi from '@vapi-ai/web';
import io from 'socket.io-client';
import './App.css';

// Initialize Vapi client with environment variable
const vapi = new Vapi(process.env.REACT_APP_VAPI_PUBLIC_KEY || '4e22bf06-bde8-4fe4-bcc0-e832850501ee');

// Enhanced brainstorming assistant configuration
const BRAINSTORM_ASSISTANT = {
  model: {
    provider: "openai",
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `You are a meeting assistant that:
        1. LISTENS to conversations and captures them as meeting transcripts
        2. ANALYZES the discussion context and topics
        3. AUTOMATICALLY generates creative brainstorming suggestions based on what was discussed
        
        When you hear conversations, convert them into clear meeting notes and then provide 3-5 specific, actionable brainstorming ideas that build on the discussion.`
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
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [meetingContext, setMeetingContext] = useState(null);
  const [userContext, setUserContext] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [runningContext, setRunningContext] = useState('');
  const [supportedApis, setSupportedApis] = useState([]);

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

  // Generate live brainstorming suggestions as conversation happens
  const generateLiveSuggestions = async (latestMessage) => {
    try {
      if (conversationHistory.length < 2) return;
      
      console.log('🧠 Generating live brainstorming suggestions...');
      
      const conversationSummary = conversationHistory
        .filter(msg => msg.role === 'user')
        .map(msg => msg.text)
        .join(' | ');
      
      const promptForSuggestions = `Meeting conversation so far: "${conversationSummary}". Latest: "${latestMessage}". Provide 3 specific brainstorming ideas to advance this discussion.`;
      
      // Send brainstorming request to Vapi
      await vapi.send({
        type: 'add-message',
        message: {
          role: 'user',
          content: promptForSuggestions
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to generate live suggestions:', error);
    }
  };

  // Parse AI brainstorming suggestions from response
  const parseBrainstormingSuggestions = (aiResponse) => {
    try {
      console.log('📋 Parsing brainstorming suggestions from AI...');
      
      // Split response into individual suggestions
      const suggestions = aiResponse
        .split(/\d+\.|\n|\|/)
        .map(s => s.trim())
        .filter(s => s.length > 10 && !s.toLowerCase().includes('brainstorm'));
      
      if (suggestions.length > 0) {
        setBrainstormSuggestions(prev => [...prev, ...suggestions.slice(0, 3)]);
        console.log('✅ Added brainstorming suggestions:', suggestions);
      }
    } catch (error) {
      console.error('❌ Failed to parse suggestions:', error);
    }
  };

  // Generate contextual brainstorming suggestions based on conversation
  const generateContextualSuggestions = async () => {
    if (conversationHistory.length === 0) return;
    
    setIsAnalyzing(true);
    setBrainstormSuggestions([]);
    
    try {
      console.log('🧠 Analyzing conversation for brainstorming suggestions...');
      
      // Create conversation summary
      const userMessages = conversationHistory
        .filter(msg => msg.role === 'user')
        .map(msg => msg.text)
        .join(' ');
      
      // Use Vapi to generate contextual suggestions
      const contextPrompt = `Based on this conversation: "${userMessages}", provide 3-5 specific, creative brainstorming ideas that could help solve problems, spark innovation, or explore new directions discussed. Format as numbered list.`;
      
      // Send to Vapi for analysis
      await vapi.send({
        type: 'add-message',
        message: {
          role: 'user',
          content: contextPrompt
        }
      });
      
      // Listen for the brainstorming response
      vapi.on('message', (message) => {
        if (message.type === 'transcript' && message.role === 'assistant') {
          const suggestions = message.text.split('\n').filter(line => line.trim());
          setBrainstormSuggestions(suggestions);
          setIsAnalyzing(false);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to generate suggestions:', error);
      setIsAnalyzing(false);
    }
  };

  // Manual trigger for generating suggestions
  const analyzeMeetingContext = async () => {
    await generateContextualSuggestions();
  };

  // Enhanced Vapi: Listen → Transcript → Auto-Brainstorm
  const startVapiBrainstorm = async () => {
    try {
      console.log('🎤 Starting Vapi: Listen → Transcript → Brainstorm...');
      
      // Start Vapi with enhanced configuration
      await vapi.start(process.env.REACT_APP_VAPI_ASSISTANT_ID || 'a4881746-c6ba-4399-a6ce-03b2183168ca');
      
      setIsVapiConnected(true);
      setConversationHistory([]); // Reset conversation
      setBrainstormSuggestions([]); // Reset suggestions
      
      console.log('✅ Vapi listening - Will convert speech to meeting notes and generate brainstorming ideas!');
      
      // Enhanced event handling
      vapi.on('call-start', () => {
        console.log('🎉 Meeting transcription started');
      });
      
      vapi.on('call-end', () => {
        console.log('📞 Call ended - Generating final brainstorming suggestions');
        setTimeout(() => generateContextualSuggestions(), 1000);
      });
      
      vapi.on('transcript', (transcript) => {
        console.log('📝 Speech → Transcript:', transcript);
        
        // Add to meeting conversation transcript
        const meetingNote = {
          speaker: transcript.role === 'user' ? 'Participant' : 'AI Assistant',
          text: transcript.text,
          timestamp: new Date().toLocaleTimeString(),
          role: transcript.role
        };
        
        // Update conversation history (for AI analysis)
        setConversationHistory(prev => [...prev, meetingNote]);
        
        // Update meeting transcripts (for display)
        setMeetingTranscripts(prev => [...prev, {
          speaker: meetingNote.speaker,
          message: meetingNote.text,
          timestamp: meetingNote.timestamp
        }]);
        
        // Auto-generate suggestions after collecting some conversation
        if (conversationHistory.length > 2 && transcript.role === 'user') {
          setTimeout(() => generateLiveSuggestions(transcript.text), 2000);
        }
      });
      
      vapi.on('message', (message) => {
        console.log('💬 AI Response:', message);
        if (message.type === 'assistant-message') {
          // Parse AI brainstorming suggestions
          parseBrainstormingSuggestions(message.content);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to start Vapi:', error);
      alert('Failed to start meeting assistant. Please check your internet connection.');
    }
  };

  // Stop Vapi brainstorming
  const stopVapiBrainstorm = () => {
    try {
      console.log('⏹️ Stopping Vapi brainstorming...');
      vapi.stop();
      setIsVapiConnected(false);
      console.log('✅ Vapi stopped');
    } catch (error) {
      console.error('❌ Failed to stop Vapi:', error);
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
          <h2>🎤 AI Meeting Assistant</h2>
          <p className="workflow-description">
            🗣️ <strong>Talk</strong> → 📝 <strong>Transcript</strong> → 🧠 <strong>Brainstorm Ideas</strong>
          </p>
          
          <div className="assistant-controls">
            <button 
              onClick={isVapiConnected ? stopVapiBrainstorm : startVapiBrainstorm}
              className={isVapiConnected ? "stop-button active" : "talk-button"}
            >
              {isVapiConnected ? '⏹️ Stop Meeting Assistant' : '🎤 Start Meeting Assistant'}
            </button>
            
            {conversationHistory.length > 0 && (
              <button 
                onClick={analyzeMeetingContext}
                className="analyze-button"
                disabled={isAnalyzing}
              >
                {isAnalyzing ? '🔄 Analyzing...' : '🧠 Generate More Ideas'}
              </button>
            )}
          </div>

          {/* Live Status */}
          {isVapiConnected && (
            <div className="live-status">
              <span className="listening-indicator">🔴 LIVE - Listening and generating ideas...</span>
            </div>
          )}

          {/* Meeting Transcript */}
          {conversationHistory.length > 0 && (
            <div className="conversation-section">
              <h3>📝 Meeting Conversation</h3>
              <div className="conversation-history">
                {conversationHistory.map((message, index) => (
                  <div key={index} className={`message ${message.role}`}>
                    <span className="speaker">{message.speaker} ({message.timestamp}):</span>
                    <span className="text">{message.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Brainstorming Suggestions */}
          {brainstormSuggestions.length > 0 && (
            <div className="suggestions-section">
              <h3>💡 AI Brainstorming Suggestions</h3>
              <div className="suggestions-list">
                {brainstormSuggestions.map((suggestion, index) => (
                  <div key={index} className="suggestion-item">
                    <span className="suggestion-number">{index + 1}.</span>
                    <span className="suggestion-text">{suggestion}</span>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setBrainstormSuggestions([])} 
                className="clear-suggestions"
              >
                🗑️ Clear Suggestions
              </button>
            </div>
          )}
        </section>
        </section>

        {/* Transcription Controls */}
        <section className="transcription-section">
          <h2>📝 Meeting Transcription</h2>
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