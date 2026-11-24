import React, { useState, useRef, useEffect } from 'react';
import './Chatbot.css';
import { askAIAgent, getAIModelLimits, getStoredUser } from '../../services/api';

const CHAT_ROOMS_STORAGE_KEY = 'ctrack_web_chat_rooms_v1';
const ACTIVE_CHAT_ROOM_STORAGE_KEY = 'ctrack_web_active_chat_room_v1';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const MODEL_OPTIONS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Default)' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat (Fallback 1)' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Fallback 2)' },
];

// Icon SVG
const IconBot = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
  </svg>
);

const IconMessage = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>
  </svg>
);

const IconSend = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const createWelcomeMessage = () => ({
  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  text: 'Halo! 👋 Saya adalah Citi assistent Anda. Bagaimana saya dapat membantu Anda hari ini?',
  sender: 'bot',
  timestamp: new Date().toISOString(),
});

const getGptLikeRoomName = (text) => {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return 'Chat Baru';
  const maxTitleLength = 36;
  if (normalizedText.length <= maxTitleLength) return normalizedText;
  return `${normalizedText.slice(0, maxTitleLength).trim()}...`;
};

const createRoom = (name = 'Chat Baru') => {
  const now = new Date().toISOString();
  return {
    id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
    messages: [createWelcomeMessage()],
  };
};

const getDefaultRooms = () => [createRoom('Chat Baru')];

const parseRooms = (rawRooms) => {
  if (!Array.isArray(rawRooms) || rawRooms.length === 0) return getDefaultRooms();
  return rawRooms.map((room, index) => {
    const now = new Date().toISOString();
    const roomName = room?.name || 'Chat Baru';
    const roomMessages = Array.isArray(room?.messages) && room.messages.length > 0
      ? room.messages
      : [createWelcomeMessage()];
    return {
      id: room?.id || `room-${Date.now()}-${index}`,
      name: roomName,
      createdAt: room?.createdAt || now,
      updatedAt: room?.updatedAt || now,
      messages: roomMessages.map((message) => ({
        id: message?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: message?.text || '',
        sender: message?.sender === 'user' ? 'user' : 'bot',
        timestamp: message?.timestamp || now,
      })),
    };
  });
};

const buildConversationPayload = (messages = []) => {
  return messages
    .filter((message) => message?.text && (message.sender === 'user' || message.sender === 'bot'))
    .slice(-20)
    .map((message) => ({
      role: message.sender === 'user' ? 'user' : 'assistant',
      content: String(message.text || '').trim(),
    }))
    .filter((item) => item.content.length > 0);
};

// Helper: ambil inisial nama room
const getRoomInitial = (name) => {
  if (!name) return 'C';
  const cleaned = name.replace(/[^\w\s]/g, '').trim();
  if (!cleaned) return 'C';
  return cleaned.charAt(0).toUpperCase();
};

// Helper: format model name
const formatModelName = (modelName) => {
  if (!modelName) return 'AI';
  const map = {
    'llama-3.1-8b-instant': 'Llama 3.1 8B',
    'deepseek-chat': 'DeepSeek',
    'gemini-2.5-flash': 'Gemini 2.5',
  };
  return map[modelName] || modelName;
};

function Chatbot() {
  const [rooms, setRooms] = useState(() => {
    try {
      const saved = localStorage.getItem(CHAT_ROOMS_STORAGE_KEY);
      if (!saved) return getDefaultRooms();
      return parseRooms(JSON.parse(saved));
    } catch (error) {
      console.error('Failed to parse chat rooms:', error);
      return getDefaultRooms();
    }
  });
  const [activeRoomId, setActiveRoomId] = useState(() => {
    return localStorage.getItem(ACTIVE_CHAT_ROOM_STORAGE_KEY);
  });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [modelLimits, setModelLimits] = useState([]);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsError, setLimitsError] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const messagesEndRef = useRef(null);

  const activeRoom = rooms.find((room) => room.id === activeRoomId) || rooms[0];
  const messages = activeRoom?.messages || [];

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      setActiveRoomId(rooms[0].id);
      return;
    }
    const isActiveRoomExists = rooms.some((room) => room.id === activeRoomId);
    if (!isActiveRoomExists && rooms.length > 0) {
      setActiveRoomId(rooms[0].id);
    }
  }, [rooms, activeRoomId]);

  useEffect(() => {
    localStorage.setItem(CHAT_ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  }, [rooms]);

  useEffect(() => {
    if (activeRoomId) {
      localStorage.setItem(ACTIVE_CHAT_ROOM_STORAGE_KEY, activeRoomId);
    }
  }, [activeRoomId]);

  useEffect(() => {
    const fetchModelLimits = async () => {
      setLimitsLoading(true);
      setLimitsError('');
      try {
        const data = await getAIModelLimits();
        const models = Array.isArray(data?.models) ? data.models : [];
        setModelLimits(models);
        setIsOnline(true);
      } catch (error) {
        console.error('Failed to fetch AI model limits:', error);
        setLimitsError('Gagal memuat limit model');
        setIsOnline(false);
      } finally {
        setLimitsLoading(false);
      }
    };
    fetchModelLimits();
  }, []);

  useEffect(() => {
    if (!Array.isArray(modelLimits) || modelLimits.length === 0) return;
    const isModelValid = modelLimits.some((item) => item?.name === selectedModel);
    if (!isModelValid) {
      setSelectedModel(modelLimits[0]?.name || DEFAULT_MODEL);
    }
  }, [modelLimits, selectedModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeRoomId]);

  const appendMessageToActiveRoom = (message, options = {}) => {
    if (!activeRoom?.id) return;
    setRooms((previousRooms) =>
      previousRooms.map((room) =>
        room.id === activeRoom.id
          ? {
              ...room,
              name:
                options.renameByFirstUserPrompt && room.messages.every((item) => item.sender !== 'user')
                  ? getGptLikeRoomName(options.renameByFirstUserPrompt)
                  : room.name,
              updatedAt: new Date().toISOString(),
              messages: [...room.messages, message],
            }
          : room
      )
    );
  };

  const handleCreateRoom = () => {
    const newRoomName = 'Chat Baru';
    const newRoom = createRoom(newRoomName);
    setRooms((previousRooms) => [...previousRooms, newRoom]);
    setActiveRoomId(newRoom.id);
    setInputValue('');
  };

  const handleDeleteRoom = (roomId) => {
    setRooms((previousRooms) => {
      const filteredRooms = previousRooms.filter((room) => room.id !== roomId);
      if (filteredRooms.length === 0) {
        const fallbackRoom = createRoom('Chat Baru');
        setActiveRoomId(fallbackRoom.id);
        return [fallbackRoom];
      }
      if (activeRoomId === roomId) {
        setActiveRoomId(filteredRooms[0].id);
      }
      return filteredRooms;
    });
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || !activeRoom?.id) return;
    const userText = inputValue.trim();
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: userText,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };
    appendMessageToActiveRoom(userMessage, { renameByFirstUserPrompt: userText });
    setInputValue('');
    setIsLoading(true);
    try {
      const storedUser = getStoredUser();
      const roomHistory = buildConversationPayload([...(messages || []), userMessage]);
      const data = await askAIAgent({
        question: userText,
        userId: storedUser?.id,
        roomId: activeRoom?.id,
        preferredModel: selectedModel,
        conversation: roomHistory,
      });
      const botResponseText = data?.answer || data?.data || 'Maaf, saya tidak dapat memproses permintaan Anda saat ini.';
      const source = data?.source;
      const sourceLabel =
        source === 'rule-based'
          ? '\n\n_(Mode fallback backend aktif)_'
          : source === 'ai'
            ? ''
            : '';
      const botMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: `${botResponseText}${sourceLabel}`,
        sender: 'bot',
        timestamp: new Date().toISOString(),
      };
      appendMessageToActiveRoom(botMessage);
    } catch (error) {
      console.error('Error calling backend AI agent:', error);
      const errorMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: 'Maaf, terjadi kesalahan. Silakan coba lagi nanti.',
        sender: 'bot',
        timestamp: new Date().toISOString(),
      };
      appendMessageToActiveRoom(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectedModelLimit = modelLimits.find((item) => item.name === selectedModel) || null;
  const isModelAvailable = selectedModelLimit && !selectedModelLimit.blockedBy;
  const finalOnlineStatus = isOnline && isModelAvailable;

  return (
    <div className="chatbot-container">
      <div className="chatbot-shell">
        {/* ══════ SIDEBAR ══════ */}
        <aside className="room-panel">
          <div className="room-panel-header">
            <div className="room-panel-header-icon">
              <IconBot />
            </div>
            <div className="room-panel-header-text">
              <h2>Asisten Citi</h2>
              <p className="room-panel-subtitle">Riwayat percakapan tersimpan otomatis</p>
            </div>
          </div>

          <button type="button" className="new-room-button" onClick={handleCreateRoom}>
            <IconMessage />
            <span>Percakapan Baru</span>
          </button>

          <div className="room-section-label">PERCAKAPAN</div>

          <div className="room-list">
            {rooms.map((room) => {
              const lastMessage = room.messages[room.messages.length - 1];
              return (
                <div key={room.id} className={`room-item ${activeRoom?.id === room.id ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="room-select-button"
                    onClick={() => setActiveRoomId(room.id)}
                  >
                    <div className="room-avatar">{getRoomInitial(room.name)}</div>
                    <div className="room-info">
                      <span className="room-name">{room.name}</span>
                      <span className="room-preview">
                        {lastMessage?.text?.slice(0, 40) || 'Tidak ada pesan'}
                        {lastMessage?.text?.length > 40 ? '...' : ''}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="room-delete-button"
                    onClick={() => handleDeleteRoom(room.id)}
                    aria-label={`Hapus ${room.name}`}
                  >
                    Hapus
                  </button>
                </div>
              );
            })}
          </div>

          <div className="room-panel-footer">
            <div className="room-footer-logo">
              <IconBot />
              <span className={`room-footer-status-dot ${finalOnlineStatus ? 'online' : 'offline'}`} />
            </div>
            <div className="room-footer-info">
              <span className="room-footer-name">Citi AI</span>
              <span className="room-footer-model">Didukung oleh {formatModelName(selectedModel)}</span>
            </div>
          </div>
        </aside>

        {/* ══════ MAIN CHAT ══════ */}
        <div className="chat-main">
          <div className="chatbot-header">
            <div className="header-content">
              <div className="header-left">
                <div className="header-avatar">
                  <IconBot />
                </div>
                <div className="header-title-group">
                  <div className="header-title-row">
                    <h1>Citi</h1>
                    <span className={`header-online-badge ${finalOnlineStatus ? 'online' : 'offline'}`}>
                      <span className={`header-online-dot ${finalOnlineStatus ? 'green' : 'red'}`} />
                      {finalOnlineStatus ? 'Online' : 'Offline'}
                    </span>
                    <span className="header-counter-badge">{messages.length} pesan</span>
                  </div>
                  <p className="header-subtitle">{activeRoom?.name || 'Percakapan'}</p>
                </div>
              </div>
              <div className="header-right">
                <span className="header-model-badge">
                  <span className="header-model-dot" />
                  {formatModelName(selectedModel)}
                </span>
              </div>
            </div>

            <div className="model-panel">
              <div className="model-panel-row">
                <label htmlFor="model-select">Model AI</label>
                <select
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="model-select"
                  disabled={isLoading}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="model-panel-info">
                {limitsLoading && <span className="model-chip info">Memuat limit...</span>}
                {!limitsLoading && limitsError && <span className="model-chip danger">{limitsError}</span>}
                {!limitsLoading && !limitsError && selectedModelLimit && (
                  <>
                    <span className="model-chip">
                      Harian: {selectedModelLimit.requests_today}/{selectedModelLimit.limit?.rpd}
                    </span>
                    <span className="model-chip">
                      Sisa: {selectedModelLimit.remaining_requests}
                    </span>
                    {selectedModelLimit.blockedBy && (
                      <span className="model-chip danger">Diblokir: {selectedModelLimit.blockedBy}</span>
                    )}
                  </>
                )}
                {!limitsLoading && !limitsError && !selectedModelLimit && (
                  <span className="model-chip info">Model tidak tersedia di backend</span>
                )}
              </div>
            </div>
          </div>

          <div className="messages-container">
            {messages.map((message) => (
              <div key={message.id} className={`message-wrapper ${message.sender}`}>
                <div className={`message-avatar ${message.sender}`}>
                  {message.sender === 'bot' ? <IconBot /> : 'A'}
                </div>
                <div className="message-body">
                  <div className="message-meta">{message.sender === 'bot' ? 'Citi' : 'Anda'}</div>
                  <div className={`message ${message.sender}`}>
                    <div className="message-text">{message.text}</div>
                  </div>
                  <span className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="message-wrapper bot">
                <div className="message-avatar bot">
                  <IconBot />
                </div>
                <div className="message-body">
                  <div className="message-meta">Citi</div>
                  <div className="message bot loading">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="input-container">
            <div className="input-wrapper">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Tanyakan sesuatu ke Citi..."
                rows="1"
                disabled={isLoading}
                className="message-input"
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputValue.trim() || !activeRoom?.id}
                className="send-button"
                aria-label="Kirim pesan"
              >
                <IconSend />
              </button>
            </div>
            <div className="input-footer">
              <div className="input-shortcuts">
                <span><kbd>Enter</kbd> kirim</span>
                <span><kbd>Shift</kbd> + <kbd>Enter</kbd> baris baru</span>
              </div>
              <p className="input-hint">AI dapat membuat kesalahan. Verifikasi informasi penting.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Chatbot;