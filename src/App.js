import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  MessageSquare,
  Database,
  Bot,
  ArrowRightCircle,
  X,
  Send,
  Save,
  Play
} from 'lucide-react';
import './App.css';

// --- Custom Node Components --- //
const CustomNode = ({ data, icon: Icon, label, color }) => (
  <div style={{
    padding: '10px 15px',
    background: 'white',
    border: '1px solid #ccc',
    borderRadius: '8px',
    minWidth: '150px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }}>
    <Handle type="target" position={Position.Left} style={{ background: '#555' }} />
    <div style={{
      background: color || '#eff6ff',
      padding: '6px',
      borderRadius: '6px',
      color: '#2563eb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Icon size={16} />
    </div>
    <div>
      <div style={{ fontSize: '14px', fontWeight: '600' }}>{label}</div>
      <div style={{ fontSize: '10px', color: '#666' }}>{data.subtext || 'Configure...'}</div>
    </div>
    <Handle type="source" position={Position.Right} style={{ background: '#555' }} />
  </div>
);

const nodeTypes = {
  inputNode: (props) => <CustomNode {...props} icon={MessageSquare} label="User Query" color="#dbeafe" />,
  llmNode: (props) => <CustomNode {...props} icon={Bot} label="LLM Engine" color="#fef3c7" />,
  knowledgeNode: (props) => <CustomNode {...props} icon={Database} label="Knowledge Base" color="#d1fae5" />,
  outputNode: (props) => <CustomNode {...props} icon={ArrowRightCircle} label="Output" color="#fce7f3" />,
};

// --- API Configuration --- //
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// --- Main Application --- //
const App = () => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Chat State
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', content: 'Hi! I am your GenAI Stack assistant. Build a flow and ask me anything.' }
  ]);
  const [query, setQuery] = useState('');

  // Show toast notification
  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 1. Drag & Drop Logic
  const onDragStart = (event, nodeType, label) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      const label = event.dataTransfer.getData('application/label');

      if (!type) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `node_${+new Date()}`,
        type,
        position,
        data: { label: label, subtext: 'Not Configured' },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  // 2. Node Selection for Config Panel
  const onNodeClick = (event, node) => setSelectedNode(node);

  // 3. Update Node Data from Config Panel
  const updateNodeData = (key, value) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNode.id) {
          const newData = { ...n.data, [key]: value };
          // Update visual subtext for better UX
          if (key === 'model') newData.subtext = value;
          if (key === 'filename') newData.subtext = value;
          if (key === 'embeddingModel') newData.subtext = value;
          return { ...n, data: newData };
        }
        return n;
      })
    );
    setSelectedNode((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
  };

  // 4. Validate Workflow
  const validateWorkflow = () => {
    // Check for required components
    const hasInput = nodes.some(n => n.type === 'inputNode');
    const hasOutput = nodes.some(n => n.type === 'outputNode');
    const hasLLM = nodes.some(n => n.type === 'llmNode');

    if (!hasInput) {
      showToast('Workflow must have a User Query component');
      return false;
    }
    if (!hasOutput) {
      showToast('Workflow must have an Output component');
      return false;
    }
    if (!hasLLM) {
      showToast('Workflow must have an LLM Engine component');
      return false;
    }

    // Check for connections
    if (edges.length === 0) {
      showToast('Components must be connected');
      return false;
    }

    return true;
  };

  // 5. Build Stack
  const handleBuildStack = async () => {
    if (!validateWorkflow()) return;

    setIsLoading(true);
    try {
      // Prepare workflow data matching backend schema
      const workflowData = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type,
          data: {
            label: n.data.label || n.type,
            config: {
              model: n.data.model,
              system_prompt: n.data.prompt,
              vector_collection_id: n.data.documentId,
              ...n.data
            }
          },
          position: n.position
        })),
        edges: edges.map(e => ({
          id: e.id || `edge_${e.source}_${e.target}`,
          source: e.source,
          target: e.target
        })),
        user_query: ''
      };

      const response = await fetch(`${API_BASE_URL}/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowData)
      });

      if (response.ok) {
        const data = await response.json();
        showToast('Workflow validated successfully!', 'success');
        console.log('Execution plan:', data.plan);
      } else {
        const error = await response.json();
        showToast(error.detail || 'Validation failed');
      }
    } catch (error) {
      console.error('Validation error:', error);
      showToast('Backend not available. Check if server is running.');
    }
    setIsLoading(false);
  };

  // 6. Chat Execution with SSE streaming
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    if (!validateWorkflow()) return;

    const userQuery = query;
    setChatHistory(prev => [...prev, { role: 'user', content: userQuery }]);
    setQuery('');
    setIsLoading(true);

    try {
      // Prepare request data matching backend WorkflowRequest schema
      const requestData = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type,
          data: {
            label: n.data.label || n.type,
            config: {
              model: n.data.model || 'llama-3.3-70b-versatile',
              system_prompt: n.data.prompt || 'You are a helpful assistant.',
              vector_collection_id: n.data.documentId,
              ...n.data
            }
          },
          position: n.position
        })),
        edges: edges.map(e => ({
          id: e.id || `edge_${e.source}_${e.target}`,
          source: e.source,
          target: e.target
        })),
        user_query: userQuery
      };

      const response = await fetch(`${API_BASE_URL}/run_workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });

      if (response.ok) {
        // Handle SSE streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponse = '';
        let buffer = '';  // Buffer for incomplete lines
        let statusMsg = '';

        // Add placeholder for AI response
        setChatHistory(prev => [...prev, { role: 'ai', content: '', isStreaming: true }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to buffer
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines (ending with \n\n)
          const parts = buffer.split('\n\n');
          
          // Keep the last incomplete part in buffer
          buffer = parts[parts.length - 1];
          
          // Process all complete parts
          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i].trim();
            if (!line) continue;
            
            if (line.startsWith('data: ')) {
              // LLM response data - accumulate chunks
              const content = line.substring(6).replace(/\\n/g, '\n');
              aiResponse += content;
              setChatHistory(prev => {
                const newHistory = [...prev];
                const lastIdx = newHistory.length - 1;
                if (lastIdx >= 0 && newHistory[lastIdx].role === 'ai') {
                  newHistory[lastIdx] = { role: 'ai', content: aiResponse, isStreaming: true };
                }
                return newHistory;
              });
            } else if (line.startsWith('status: ')) {
              statusMsg = line.substring(8);
              console.log('Status:', statusMsg);
            } else if (line.startsWith('final: ')) {
              // Final response - use only if we don't have streaming data
              const finalContent = line.substring(7).trim();
              if (finalContent && finalContent !== 'No response' && !aiResponse) {
                aiResponse = finalContent;
              }
            }
          }
        }

        // Process any remaining buffer content
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            const content = line.substring(6).replace(/\\n/g, '\n');
            aiResponse += content;
          } else if (line.startsWith('final: ')) {
            const finalContent = line.substring(7).trim();
            if (finalContent && !aiResponse) {
              aiResponse = finalContent;
            }
          }
        }

        // Mark streaming as complete
        setChatHistory(prev => {
          const newHistory = [...prev];
          const lastIdx = newHistory.length - 1;
          if (lastIdx >= 0 && newHistory[lastIdx].role === 'ai') {
            newHistory[lastIdx] = { role: 'ai', content: aiResponse || 'No response generated.' };
          }
          return newHistory;
        });
      } else {
        const error = await response.json();
        setChatHistory(prev => [...prev, {
          role: 'ai',
          content: `Error: ${error.detail || 'Failed to process request'}`
        }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setChatHistory(prev => [...prev, {
        role: 'ai',
        content: `Error connecting to backend. Make sure the server is running at ${API_BASE_URL}`
      }]);
    }

    setIsLoading(false);
  };

  // 7. Handle file upload for Knowledge Base
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    updateNodeData('filename', file.name);
    setIsLoading(true);

    // Upload to backend
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE_URL}/documents/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        // Store the vector_collection_id from backend
        updateNodeData('documentId', data.vector_collection_id);
        updateNodeData('subtext', file.name);
        showToast('Document uploaded and processed!', 'success');
      } else {
        const error = await response.json();
        showToast(error.detail || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      showToast('Backend not available for document processing');
    }
    setIsLoading(false);
  };

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            background: '#2563eb',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontWeight: 'bold'
          }}>S</div>
          <h2>GenAI Stack</h2>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={handleBuildStack}
            disabled={isLoading}
            style={{ display: 'flex', gap: '5px', alignItems: 'center' }}
          >
            <Save size={16} /> Build Stack
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setIsChatOpen(true)}
            style={{ display: 'flex', gap: '5px', alignItems: 'center' }}
          >
            <Play size={16} /> Chat with Stack
          </button>
        </div>
      </header>

      <div className="workspace">
        {/* Sidebar Component Library */}
        <aside className="sidebar">
          <h3 style={{ margin: 0, fontSize: '14px', color: '#999', textTransform: 'uppercase' }}>Components</h3>

          <div
            className="sidebar-item"
            onDragStart={(event) => onDragStart(event, 'inputNode', 'User Query')}
            draggable
          >
            <MessageSquare size={18} /> <span>User Query</span>
          </div>

          <div
            className="sidebar-item"
            onDragStart={(event) => onDragStart(event, 'knowledgeNode', 'Knowledge Base')}
            draggable
          >
            <Database size={18} /> <span>Knowledge Base</span>
          </div>

          <div
            className="sidebar-item"
            onDragStart={(event) => onDragStart(event, 'llmNode', 'LLM Engine')}
            draggable
          >
            <Bot size={18} /> <span>LLM Engine</span>
          </div>

          <div
            className="sidebar-item"
            onDragStart={(event) => onDragStart(event, 'outputNode', 'Output')}
            draggable
          >
            <ArrowRightCircle size={18} /> <span>Output Component</span>
          </div>
        </aside>

        {/* Canvas Area */}
        <div className="canvas-area" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background color="#ccc" gap={20} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Configuration Panel */}
        {selectedNode && (
          <aside className="config-panel">
            <div style={{
              marginBottom: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0 }}>Configuration</h3>
              <button
                onClick={() => setSelectedNode(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="config-section">
              <span className="config-label">Component ID</span>
              <input
                className="config-input"
                value={selectedNode.id}
                disabled
                style={{ background: '#f3f4f6' }}
              />
            </div>

            {/* User Query Configuration */}
            {selectedNode.type === 'inputNode' && (
              <div className="config-section">
                <p style={{ fontSize: '14px', color: '#666' }}>
                  This component accepts user queries and serves as the entry point for the workflow.
                </p>
              </div>
            )}

            {/* LLM Engine Configuration */}
            {selectedNode.type === 'llmNode' && (
              <>
                <div className="config-section">
                  <span className="config-label">Model (Groq)</span>
                  <select
                    className="config-select"
                    value={selectedNode.data.model || 'llama-3.3-70b-versatile'}
                    onChange={(e) => updateNodeData('model', e.target.value)}
                  >
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Recommended)</option>
                    <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant</option>
                    <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                    <option value="gemma2-9b-it">Gemma 2 9B</option>
                  </select>
                </div>
                <div className="config-section">
                  <span className="config-label">System Prompt</span>
                  <textarea
                    className="config-textarea"
                    placeholder="You are a helpful assistant..."
                    value={selectedNode.data.prompt || ''}
                    onChange={(e) => updateNodeData('prompt', e.target.value)}
                  />
                </div>
                <div className="config-section">
                  <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
                    API Key is configured on the backend via environment variables.
                  </p>
                </div>
              </>
            )}

            {/* Knowledge Base Configuration */}
            {selectedNode.type === 'knowledgeNode' && (
              <>
                <div className="config-section">
                  <span className="config-label">Upload Document</span>
                  <input
                    className="config-input"
                    type="file"
                    accept=".pdf,.txt,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                    {selectedNode.data.filename
                      ? `Selected: ${selectedNode.data.filename}`
                      : 'Supported: PDF, TXT, DOC'}
                  </div>
                </div>
                <div className="config-section">
                  <span className="config-label">Embedding Model</span>
                  <select
                    className="config-select"
                    value={selectedNode.data.embeddingModel || 'openai'}
                    onChange={(e) => updateNodeData('embeddingModel', e.target.value)}
                  >
                    <option value="openai">OpenAI Embeddings</option>
                    <option value="gemini">Gemini Embeddings</option>
                  </select>
                </div>
                <div className="config-section">
                  <span className="config-label">Chunk Size</span>
                  <input
                    className="config-input"
                    type="number"
                    placeholder="1000"
                    value={selectedNode.data.chunkSize || 1000}
                    onChange={(e) => updateNodeData('chunkSize', parseInt(e.target.value))}
                  />
                </div>
              </>
            )}

            {/* Output Configuration */}
            {selectedNode.type === 'outputNode' && (
              <div className="config-section">
                <p style={{ fontSize: '14px', color: '#666' }}>
                  Displays the final response to the user in the chat interface.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Chat Modal */}
      {isChatOpen && (
        <div className="chat-overlay">
          <div className="chat-box">
            <div className="chat-header">
              <span>Chat with Stack</span>
              <button
                onClick={() => setIsChatOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="chat-history">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  {msg.content}
                </div>
              ))}
              {isLoading && (
                <div className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
            </div>
            <form className="chat-input" onSubmit={handleChatSubmit}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type your query..."
                disabled={isLoading}
              />
              <button type="submit" className="btn btn-primary" disabled={isLoading}>
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default () => (
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>
);
