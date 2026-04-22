import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video, VideoOff, Send, MessageSquare, ShieldAlert, Play, Square, SkipForward, Loader2 } from 'lucide-react';
import './index.css';

// We'll connect to the backend server
const socket = io('http://localhost:3001', { autoConnect: false });

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, searching, connected
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Set local video stream once UI is rendered
  useEffect(() => {
    if (isStarted && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [isStarted]);

  useEffect(() => {
    socket.on('matched', async ({ partnerId, initiator }) => {
      setStatus('connected');
      addSystemMessage('You are now chatting with a random stranger. Say hi!');
      
      const pc = new RTCPeerConnection(iceServers);
      peerConnectionRef.current = pc;

      // Add local tracks to peer connection
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });

      // Handle incoming remote stream
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', event.candidate);
        }
      };

      if (initiator) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer);
        } catch (error) {
          console.error("Error creating offer", error);
        }
      }
    });

    socket.on('offer', async (offer) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socket.emit('answer', answer);
      } catch (error) {
        console.error("Error handling offer", error);
      }
    });

    socket.on('answer', async (answer) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error("Error handling answer", error);
      }
    });

    socket.on('ice_candidate', async (candidate) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error adding ice candidate", error);
      }
    });

    socket.on('receive_message', (msg) => {
      setMessages(prev => [...prev, { text: msg, sender: 'stranger' }]);
    });

    socket.on('partner_left', () => {
      addSystemMessage('Stranger has disconnected.');
      cleanupConnection();
      findNext();
    });

    return () => {
      socket.off('matched');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice_candidate');
      socket.off('receive_message');
      socket.off('partner_left');
    };
  }, []);

  const getMedia = async () => {
    console.log("Requesting camera access...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      console.log("Camera stream received");
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return true;
    } catch (err) {
      console.error("Error accessing camera:", err);
      if (err.name === 'NotAllowedError') {
        alert("Permission to access camera and microphone was denied.");
      } else if (err.name === 'NotFoundError') {
        alert("No camera or microphone found.");
      } else if (err.name === 'NotReadableError') {
        alert("Camera or microphone is already in use by another application.");
      } else {
        alert("Camera and microphone access is required to use this app.");
      }
      return false;
    }
  };

  const startChatting = async () => {
    const hasMedia = await getMedia();
    if (!hasMedia) return;

    setIsStarted(true);
    socket.connect();
    findNext();
  };

  const findNext = () => {
    cleanupConnection();
    setStatus('searching');
    setMessages([]);
    socket.emit('join_queue');
  };

  const stopChat = () => {
    cleanupConnection();
    socket.emit('leave_chat');
    socket.disconnect();
    
    // Stop camera/mic tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    setIsStarted(false);
    setStatus('idle');
  };

  const cleanupConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCamEnabled(videoTrack.enabled);
      }
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || status !== 'connected') return;
    
    const msg = messageInput.trim();
    socket.emit('send_message', msg);
    setMessages(prev => [...prev, { text: msg, sender: 'you' }]);
    setMessageInput('');
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { text, sender: 'system' }]);
  };

  const handleReport = () => {
    // Placeholder for AI Moderation / Reporting
    alert("User reported. Thank you for keeping the community safe. The connection will now be skipped.");
    findNext();
  };

  if (!isStarted) {
    return (
      <div className="landing-container">
        <div className="landing-card">
          <h1>Random Video Chat</h1>
          <p>Connect with people around the world instantly.</p>
          
          <div className="rules-box">
            <h3><ShieldAlert size={20} /> Community Guidelines (18+)</h3>
            <ul>
              <li>You must be 18 years or older to use this service.</li>
              <li>No nudity, sexually explicit content, or harassment.</li>
              <li>Do not share personal or sensitive information.</li>
              <li>Violators will be permanently banned.</li>
            </ul>
          </div>

          <button className="start-btn" onClick={startChatting}>
            Agree & Start Chatting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Main Video Section */}
      <div className="video-section">
        <div className="videos-container">
          <div className="video-wrapper">
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
            />
            <div className="video-label">You</div>
          </div>
          
          <div className="video-wrapper stranger">
            {status === 'searching' && (
              <div className="status-overlay">
                <div className="status-text">
                  <Loader2 className="spinner" />
                  Searching for partner...
                </div>
              </div>
            )}
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
            />
            <div className="video-label">Stranger</div>
          </div>
        </div>

        {/* Controls */}
        <div className="controls-bar">
          <div className="control-group">
            <button className="danger-btn" onClick={stopChat}>
              <Square size={20} fill="currentColor" /> Stop
            </button>
            <button className="primary-btn" onClick={findNext}>
              <SkipForward size={20} fill="currentColor" /> Next
            </button>
          </div>

          <div className="control-group">
            <button 
              className={`icon-btn ${!micEnabled ? 'active' : ''}`} 
              onClick={toggleMic}
              title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
            >
              {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button 
              className={`icon-btn ${!camEnabled ? 'active' : ''}`} 
              onClick={toggleCam}
              title={camEnabled ? "Disable Camera" : "Enable Camera"}
            >
              {camEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>

          <div className="control-group">
            <button className="icon-btn" style={{color: '#ef4444'}} onClick={handleReport} title="Report Abuse">
              <ShieldAlert size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Chat Section */}
      <div className="chat-section">
        <div className="chat-header">
          <MessageSquare size={20} /> Text Chat
        </div>
        
        <div className="messages-container">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.sender}`}>
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
          <form className="chat-form" onSubmit={sendMessage}>
            <input 
              type="text" 
              className="chat-input" 
              placeholder={status === 'connected' ? "Type a message..." : "Waiting for partner..."}
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              disabled={status !== 'connected'}
            />
            <button 
              type="submit" 
              className="send-btn" 
              disabled={status !== 'connected' || !messageInput.trim()}
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
