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
  const [isListening, setIsListening] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState(null);
  const [transcript, setTranscript] = useState('');
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

    // Initialize Chrome Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      // Optimized settings for conversation capture
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => {
        console.log('🎤 Chrome Speech Recognition started - Listening to conversation...');
        setIsListening(true);
      };
      
      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        // Process all speech results
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
            console.log('📝 Final speech captured:', transcript);
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Update live transcript display
        setTranscript(finalTranscript + interimTranscript);
        
        // Add completed sentences to conversation
        if (finalTranscript && finalTranscript.trim().length > 3) {
          addToConversation(finalTranscript.trim());
        }
      };
      
      recognition.onerror = (event) => {
        console.error('❌ Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          console.log('ℹ️ No speech detected, continuing to listen...');
        } else if (event.error === 'network') {
          console.log('⚠️ Network error, but continuing with offline recognition...');
        } else {
          setIsListening(false);
        }
      };
      
      recognition.onend = () => {
        console.log('🔇 Speech recognition ended');
        setIsListening(false);
        
        // Auto-restart if we're supposed to be listening
        if (isVapiConnected) {
          console.log('🔄 Auto-restarting speech recognition...');
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {
              console.log('ℹ️ Could not restart recognition:', e.message);
            }
          }, 100);
        }
      };
      
      setSpeechRecognition(recognition);
      console.log('✅ Chrome Speech Recognition initialized for conversation capture');
    } else {
      console.warn('⚠️ Speech Recognition not supported in this browser - please use Chrome');
    }
  }, [isVapiConnected]);

  // Add conversation to history and trigger contextual brainstorming
  const addToConversation = (text) => {
    if (!text || text.trim().length < 5) return;
    
    const cleanText = text.trim();
    console.log('➕ Adding conversation segment:', cleanText);
    
    const newMessage = {
      speaker: 'Participant',
      text: cleanText,
      timestamp: new Date().toLocaleTimeString(),
      role: 'user'
    };
    
    // Update conversation history
    setConversationHistory(prev => {
      const updated = [...prev, newMessage];
      console.log('📊 Updated conversation history:', updated.map(m => m.text).join(' | '));
      return updated;
    });
    
    // Update meeting transcripts for display
    setMeetingTranscripts(prev => [...prev, {
      speaker: newMessage.speaker,
      message: newMessage.text,
      timestamp: newMessage.timestamp
    }]);
    
    // Generate contextual brainstorming suggestions
    setTimeout(() => generateContextualAI(cleanText), 1500);
  };

  // Generate contextual AI suggestions based on real conversation
  const generateContextualAI = async (latestText) => {
    try {
      console.log('🧠 Analyzing conversation context for brainstorming...', latestText);
      
      // Get full conversation context
      const fullConversation = conversationHistory
        .map(msg => msg.text)
        .join(' ');
      
      const contextToAnalyze = fullConversation + ' ' + latestText;
      
      if (contextToAnalyze.length < 20) {
        console.log('ℹ️ Need more conversation to generate meaningful suggestions');
        return;
      }
      
      console.log('📊 Full conversation context:', contextToAnalyze);
      
      // Analyze conversation and generate contextual suggestions
      const suggestions = analyzeConversationAndSuggest(contextToAnalyze);
      
      if (suggestions.length > 0) {
        setBrainstormSuggestions(prev => {
          // Add only new, non-duplicate suggestions
          const newSuggestions = suggestions.filter(newSug => 
            !prev.some(existingSug => 
              existingSug.toLowerCase().includes(newSug.toLowerCase().substring(0, 20))
            )
          );
          
          if (newSuggestions.length > 0) {
            console.log('✅ Generated contextual suggestions:', newSuggestions);
            return [...prev, ...newSuggestions];
          }
          return prev;
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to generate contextual AI:', error);
    }
  };

  // Intelligent conversation analysis for brainstorming
  const analyzeConversationAndSuggest = (conversationText) => {
    const text = conversationText.toLowerCase();
    let suggestions = [];
    
    // Problem identification patterns
    if (text.includes('problem') || text.includes('issue') || text.includes('challenge')) {
      suggestions.push('Let\'s break this problem down into smaller, more manageable parts');
      suggestions.push('What if we approached this from a completely different angle?');
      suggestions.push('Has anyone tried a similar solution in a different context?');
    }
    
    // Stuck/blocked conversation patterns
    if (text.includes('stuck') || text.includes('blocked') || text.includes('don\'t know')) {
      suggestions.push('What would happen if we removed all current constraints?');
      suggestions.push('Let\'s list 3 crazy ideas first, then work backwards to practical ones');
      suggestions.push('Who else has solved something similar? Can we adapt their approach?');
    }
    
    // Decision-making patterns
    if (text.includes('decide') || text.includes('choose') || text.includes('option')) {
      suggestions.push('Let\'s create a pros and cons matrix for each option');
      suggestions.push('What would our users/customers prefer and why?');
      suggestions.push('Which option gives us the most flexibility for future changes?');
    }
    
    // Innovation/creativity patterns
    if (text.includes('innovative') || text.includes('creative') || text.includes('new idea')) {
      suggestions.push('What would this look like if we designed it from scratch today?');
      suggestions.push('How would a completely different industry approach this?');
      suggestions.push('What emerging technologies could we leverage here?');
    }
    
    // Business/strategy patterns
    if (text.includes('business') || text.includes('strategy') || text.includes('revenue')) {
      suggestions.push('How does this align with our core business objectives?');
      suggestions.push('What would happen if we made this our top priority for 30 days?');
      suggestions.push('Could we test this with a small pilot group first?');
    }
    
    // Team/collaboration patterns
    if (text.includes('team') || text.includes('collaborate') || text.includes('together')) {
      suggestions.push('Which team members have expertise we haven\'t tapped into yet?');
      suggestions.push('How can we get more diverse perspectives on this?');
      suggestions.push('What would success look like from each team member\'s viewpoint?');
    }
    
    // User/customer patterns
    if (text.includes('user') || text.includes('customer') || text.includes('client')) {
      suggestions.push('Let\'s role-play as different types of users - what would they want?');
      suggestions.push('What user pain point are we really trying to solve here?');
      suggestions.push('How can we get direct feedback from users on this idea?');
    }
    
    // Time/urgency patterns
    if (text.includes('deadline') || text.includes('urgent') || text.includes('quickly')) {
      suggestions.push('What\'s the minimum viable version we could ship right now?');
      suggestions.push('Which parts can we parallel-process to save time?');
      suggestions.push('What would we cut if we only had half the time?');
    }
    
    // General conversation flow suggestions
    if (suggestions.length === 0) {
      // Analyze recent conversation sentiment and direction
      if (text.includes('what') || text.includes('how')) {
        suggestions.push('Let\'s explore 3 different approaches to this question');
        suggestions.push('What assumptions are we making that we should challenge?');
      } else if (text.includes('think') || text.includes('feel')) {
        suggestions.push('What evidence would support or contradict this thinking?');
        suggestions.push('How might someone with the opposite view respond?');
      } else {
        suggestions.push('What\'s the next logical step we should explore?');
        suggestions.push('Are there any alternative perspectives we haven\'t considered?');
        suggestions.push('How can we test this idea quickly and cheaply?');
      }
    }
    
    // Limit to 2-3 most relevant suggestions
    return suggestions.slice(0, 3);
  };

  // Manual trigger for additional brainstorming suggestions
  const generateAIBrainstormingSuggestions = async () => {
    const fullConversation = conversationHistory.map(msg => msg.text).join(' ');
    if (fullConversation) {
      await generateContextualAI(fullConversation);
    }
  };

  // Initialize Zoom SDK
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
      
      // Get meeting context with better error handling
      console.log('📋 Getting meeting context...');
      try {
        const meetingContextResponse = await zoomSdk.getMeetingContext();
        console.log('📋 Meeting context response:', meetingContextResponse);
        setMeetingContext(meetingContextResponse);
        
        // Check if we're actually in a meeting
        if (meetingContextResponse && (meetingContextResponse.meetingID || meetingContextResponse.meetingUUID)) {
          setIsMeetingConnected(true);
          console.log('✅ Successfully connected to meeting:', meetingContextResponse.meetingID || meetingContextResponse.meetingUUID);
        } else {
          console.log('ℹ️ No active meeting detected');
          setIsMeetingConnected(false);
        }
      } catch (meetingError) {
        console.log('⚠️ Could not get meeting context:', meetingError);
        setIsMeetingConnected(false);
        // Continue without meeting context - app can work standalone
      }
      
      // Get user context
      console.log('👤 Getting user context...');
      try {
        const userContextResponse = await zoomSdk.getUserContext();
        console.log('👤 User context response:', userContextResponse);
        setUserContext(userContextResponse);
        
        // Get meeting participants (if host/co-host)
        if (userContextResponse.role === 'host' || userContextResponse.role === 'coHost') {
          try {
            const participantsResponse = await zoomSdk.getMeetingParticipants();
            setParticipants(participantsResponse.participants);
          } catch (participantsError) {
            console.log('ℹ️ Could not get participants:', participantsError);
          }
        }
      } catch (userError) {
        console.log('⚠️ Could not get user context:', userError);
      }
      
      // Set up event listeners
      setupZoomEventListeners();
      
      // Connect for app-to-app communication
      try {
        await zoomSdk.connect();
        console.log('✅ Connected for app communication');
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
      console.log('🧠 Generating live brainstorming suggestions for:', latestMessage);
      
      // Wait a bit to ensure conversation history is updated
      setTimeout(async () => {
        const userMessages = conversationHistory
          .filter(msg => msg.role === 'user')
          .map(msg => msg.text)
          .slice(-5) // Get last 5 user messages
          .join(' | ');
        
        if (userMessages.length < 10) {
          console.log('ℹ️ Not enough conversation content yet');
          return;
        }
        
        console.log('📊 Conversation summary for brainstorming:', userMessages);
        
        const promptForSuggestions = `Based on this meeting conversation: "${userMessages}". Please provide 3 specific, creative brainstorming ideas that could help solve problems or explore new directions mentioned in this discussion. Format as: 1. [idea] 2. [idea] 3. [idea]`;
        
        console.log('📤 Sending brainstorming request to Vapi...');
        
        // Send brainstorming request to Vapi
        if (isVapiConnected) {
          await vapi.send({
            type: 'add-message',
            message: {
              role: 'user',
              content: promptForSuggestions
            }
          });
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Failed to generate live suggestions:', error);
    }
  };

  // Parse AI brainstorming suggestions from response
  const parseBrainstormingSuggestions = (aiResponse) => {
    try {
      console.log('📋 Parsing brainstorming suggestions from AI response:', aiResponse);
      
      if (!aiResponse || typeof aiResponse !== 'string') {
        console.log('⚠️ Invalid AI response for parsing');
        return;
      }
      
      // Split response into individual suggestions - try multiple formats
      let suggestions = [];
      
      // Try numbered list format first
      const numberedSuggestions = aiResponse.match(/\d+\.\s*([^.]+(?:\.[^0-9][^.]*)*)/g);
      if (numberedSuggestions) {
        suggestions = numberedSuggestions.map(s => s.replace(/^\d+\.\s*/, '').trim());
      } else {
        // Try line breaks
        suggestions = aiResponse
          .split(/\n+/)
          .map(s => s.trim())
          .filter(s => s.length > 15 && !s.toLowerCase().includes('brainstorm'));
      }
      
      // Clean up suggestions
      suggestions = suggestions
        .filter(s => s.length > 10)
        .slice(0, 5) // Limit to 5 suggestions
        .map(s => s.replace(/^[-•*]\s*/, '').trim()); // Remove bullet points
      
      if (suggestions.length > 0) {
        console.log('✅ Parsed suggestions:', suggestions);
        setBrainstormSuggestions(prev => {
          // Avoid duplicates
          const newSuggestions = suggestions.filter(newSug => 
            !prev.some(existingSug => existingSug.toLowerCase() === newSug.toLowerCase())
          );
          return [...prev, ...newSuggestions];
        });
      } else {
        console.log('⚠️ No valid suggestions found in response');
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
      
      // Use the correct assistant ID and configuration
      const assistantConfig = {
        assistantId: process.env.REACT_APP_VAPI_ASSISTANT_ID || 'a4881746-c6ba-4399-a6ce-03b2183168ca',
        ...BRAINSTORM_ASSISTANT
      };
      
      console.log('🔧 Vapi configuration:', assistantConfig);
      
      // Start Vapi call
      await vapi.start(assistantConfig.assistantId, {
        model: assistantConfig.model,
        voice: assistantConfig.voice,
        transcriber: assistantConfig.transcriber
      });
      
      setIsVapiConnected(true);
      setConversationHistory([]); // Reset conversation
      setBrainstormSuggestions([]); // Reset suggestions
      
      console.log('✅ Vapi listening - Will convert speech to meeting notes and generate brainstorming ideas!');
      
      // Enhanced event handling with detailed logging
      vapi.on('call-start', () => {
        console.log('🎉 Vapi call started - Listening for conversations...');
      });
      
      vapi.on('call-end', () => {
        console.log('📞 Vapi call ended - Generating final brainstorming suggestions');
        setTimeout(() => generateContextualSuggestions(), 1000);
      });
      
      vapi.on('transcript', (transcript) => {
        console.log('📝 Speech → Transcript received:', transcript);
        
        // Ensure transcript has required properties
        if (!transcript || !transcript.text) {
          console.log('⚠️ Invalid transcript received:', transcript);
          return;
        }
        
        // Add to meeting conversation transcript
        const meetingNote = {
          speaker: transcript.role === 'user' ? 'Participant' : 'AI Assistant',
          text: transcript.text,
          timestamp: new Date().toLocaleTimeString(),
          role: transcript.role || 'user'
        };
        
        console.log('➕ Adding to conversation:', meetingNote);
        
        // Update conversation history (for AI analysis)
        setConversationHistory(prev => {
          const updated = [...prev, meetingNote];
          console.log('📊 Updated conversation history:', updated);
          return updated;
        });
        
        // Update meeting transcripts (for display)
        setMeetingTranscripts(prev => [...prev, {
          speaker: meetingNote.speaker,
          message: meetingNote.text,
          timestamp: meetingNote.timestamp
        }]);
        
        // Auto-generate suggestions after collecting some conversation
        if (transcript.role === 'user' && transcript.text.length > 10) {
          console.log('🧠 Triggering brainstorming suggestions...');
          setTimeout(() => generateLiveSuggestions(transcript.text), 2000);
        }
      });
      
      vapi.on('message', (message) => {
        console.log('💬 Vapi message received:', message);
        if (message && message.type === 'assistant-message' && message.content) {
          console.log('🤖 AI Response received, parsing suggestions...');
          parseBrainstormingSuggestions(message.content);
        }
      });
      
      vapi.on('error', (error) => {
        console.error('❌ Vapi error:', error);
      });
      
    } catch (error) {
      console.error('❌ Failed to start Vapi:', error);
      alert(`Failed to start meeting assistant: ${error.message}`);
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
            🗣️ <strong>Talk</strong> → 📝 <strong>Chrome Transcription</strong> → 🧠 <strong>AI Brainstorm Ideas</strong>
          </p>
          
          <div className="assistant-controls">
            <button 
              onClick={isVapiConnected ? stopChromeTranscription : startChromeTranscription}
              className={isVapiConnected ? "stop-button active" : "talk-button"}
            >
              {isVapiConnected ? '⏹️ Stop Meeting Assistant' : '🎤 Start Chrome Transcription'}
            </button>
            
            {/* Test Mode for debugging */}
            <button 
              onClick={() => {
                // Add test conversation
                const testConversation = [
                  { speaker: 'Participant', text: 'We need to improve our user engagement', timestamp: new Date().toLocaleTimeString(), role: 'user' },
                  { speaker: 'Participant', text: 'Our current retention rate is low', timestamp: new Date().toLocaleTimeString(), role: 'user' },
                  { speaker: 'Participant', text: 'What creative solutions can we explore?', timestamp: new Date().toLocaleTimeString(), role: 'user' }
                ];
                setConversationHistory(testConversation);
                setBrainstormSuggestions([
                  'Implement gamification elements like points and badges to increase user engagement',
                  'Create personalized onboarding flows based on user preferences and behavior',
                  'Develop a community feature where users can share experiences and tips'
                ]);
              }}
              className="test-button"
            >
              🧪 Test Mode (Demo Conversation)
            </button>
            
            {conversationHistory.length > 0 && (
              <button 
                onClick={generateAIBrainstormingSuggestions}
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
              <span className="listening-indicator">
                🔴 LIVE - Chrome is listening and generating ideas...
                {isListening && transcript && (
                  <div className="live-transcript">
                    💬 "{transcript}"
                  </div>
                )}
              </span>
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