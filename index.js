import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/routes.js';
import axios from 'axios';
import session from 'express-session';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { startNotificationService } from './controllers/notificationService.js';
import { initializeSocketServer } from './sockets/socketServer.js';
import { scheduler } from './services/notificationScheduler.js'; 
import { initializeWhatsAppTemplates } from './services/whatsappMetaService.js'; 
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Define allowed origins
const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3000',
  'http://192.168.29.87:3001',  
  'http://192.168.29.87:3000',  
  'https://uxaah.com',
  'https://www.uxaah.com',
  'https://uxaah-new.onrender.com',
  'https://uxaah.vercel.app',
  'https://*.vercel.app'
];

// Better port handling
const preferredPort = process.env.PORT || 3000;
const maxPortTries = 10;

const findAvailablePort = async (startPort) => {
  for (let port = startPort; port < startPort + maxPortTries; port++) {
    try {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.listen(port, '0.0.0.0', () => {
          server.close(() => resolve(port));
        }).on('error', reject);
      });
      return port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + maxPortTries - 1}`);
};

let port;
let server;

// FIXED CORS CONFIGURATION
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('⚠️ Development: Allowing origin not in list:', origin);
      // For development, we allow it anyway to prevent blocking you
      callback(null, true);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  credentials: true,
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'X-Requested-With', 
    'X-Socket-ID',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.path} from ${req.headers.origin || 'no-origin'}`);
  next();
});

// Body parser middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
}));

// FRONTEND STATIC FILES SERVING
const frontendSrcPath = path.join(__dirname, '../frontend/src');
const frontendPublicPath = path.join(__dirname, '../frontend/public');
const frontendBuildPath = path.join(__dirname, '../frontend/build');
const frontendDistPath = path.join(__dirname, '../frontend/dist');

console.log('🔍 Checking frontend paths:');
console.log('- Frontend src:', frontendSrcPath, existsSync(frontendSrcPath) ? '✅' : '❌');
console.log('- Frontend public:', frontendPublicPath, existsSync(frontendPublicPath) ? '✅' : '❌');
console.log('- Frontend build:', frontendBuildPath, existsSync(frontendBuildPath) ? '✅' : '❌');
console.log('- Frontend dist:', frontendDistPath, existsSync(frontendDistPath) ? '✅' : '❌');

// Serve static files
app.use('/style.css', (req, res, next) => {
  const cssPath = path.join(frontendSrcPath, 'style.css');
  if (existsSync(cssPath)) {
    res.set('Content-Type', 'text/css');
    res.sendFile(cssPath);
  } else {
    res.status(404).send('CSS file not found');
  }
});

app.use('/src', express.static(frontendSrcPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.set('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      res.set('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.json')) {
      res.set('Content-Type', 'application/json');
    }
  }
}));

app.use(express.static(frontendPublicPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.set('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.html')) {
      res.set('Content-Type', 'text/html');
    }
  }
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.set('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.json')) {
      res.set('Content-Type', 'application/json');
    }
  }
}));

// DEBUGGING ENDPOINTS
app.get('/', (req, res) => {
  res.json({
    message: 'Backend API is running.',
    port: port,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      whatsapp: process.env.WHATSAPP_ACCESS_TOKEN ? 'configured' : 'not configured',
      twilio: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not configured'
    }
  });
});

app.get('/cors-test', (req, res) => {
  res.json({
    message: 'CORS is working perfectly!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
    allowedOrigins: allowedOrigins
  });
});

// API routes
app.use('/api', apiRoutes);

// NEW: WhatsApp webhook endpoint for receiving messages
app.post('/api/whatsapp/webhook', (req, res) => {
  try {
    console.log('WhatsApp webhook received:', req.body);
    
    // Verify webhook subscription
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_WEBHOOK_TOKEN) {
      console.log('Webhook verified');
      return res.send(req.query['hub.challenge']);
    }
    
    // Handle incoming messages
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
      const messages = req.body.entry[0].changes[0].value.messages;
      messages.forEach(message => {
        console.log('Incoming WhatsApp message:', message);
        // Handle message logic here
      });
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW: WhatsApp status endpoint
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: 'WhatsApp service active',
    provider: process.env.WHATSAPP_PROVIDER || 'meta',
    configured: !!process.env.WHATSAPP_ACCESS_TOKEN,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server with port detection
const startServer = async () => {
  try {
    port = await findAvailablePort(preferredPort);
    server = createServer(app);
    
    // Socket.IO instance
    const io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Make io globally available
    global.io = io;

    // Initialize socket server
    initializeSocketServer(io);

    // Connection error handling
    io.engine.on("connection_error", (err) => {
      console.log('Socket.IO connection error:', err.req);
    });

    // Health check route
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        port: port,
        socketConnections: io.engine.clientsCount,
        services: {
          whatsapp: process.env.WHATSAPP_ACCESS_TOKEN ? 'active' : 'inactive',
          notifications: 'active',
          scheduler: 'active'
        }
      });
    });

    // Axios defaults
    axios.defaults.baseURL = process.env.BASE_URL || `http://localhost:${port}`;
    axios.defaults.withCredentials = true;

    // Graceful shutdown handler
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, shutting down gracefully...');
      
      io.close(() => {
        console.log('Socket.IO server closed');
        
        // Stop WhatsApp scheduler
        if (scheduler && scheduler.stop) {
          scheduler.stop().then(() => {
            console.log('WhatsApp scheduler stopped');
          }).catch(err => {
            console.error('Error stopping scheduler:', err);
          });
        }
        
        server.close(() => {
          console.log('HTTP server closed');
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

    // Start the server
    server.listen(port, '0.0.0.0', async () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Server URL: http://localhost:${port}`);
      console.log(`🌐 CORS Test: http://localhost:${port}/cors-test`);
      console.log(`🌐 API Health: http://localhost:${port}/api/health-check`);
      console.log('✅ Socket.IO server initialized');
      
      console.log('\n🟢 INITIALIZING SERVICES:');
      
      // Start notification service
      try {
        await startNotificationService();
        console.log('✅ Notification service started');
      } catch (error) {
        console.error('❌ Failed to start notification service:', error);
      }
      
      // NEW: Start WhatsApp notification scheduler
      try {
        await scheduler.start();
        console.log('✅ WhatsApp notification scheduler started');
      } catch (error) {
        console.error('❌ Failed to start WhatsApp scheduler:', error);
      }
      
      // NEW: Initialize WhatsApp templates
      try {
        await initializeWhatsAppTemplates();
        console.log('✅ WhatsApp templates initialized');
      } catch (error) {
        console.error('❌ Failed to initialize WhatsApp templates:', error);
      }
      
      console.log('\n📱 WHATSAPP SERVICE STATUS:');
      console.log(`   Provider: ${process.env.WHATSAPP_PROVIDER || 'meta'}`);
      console.log(`   Access Token: ${process.env.WHATSAPP_ACCESS_TOKEN ? 'Set ✓' : 'Not set ✗'}`);
      console.log(`   Phone Number ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID ? 'Set ✓' : 'Not set ✗'}`);
      console.log(`   Webhook Token: ${process.env.WHATSAPP_WEBHOOK_TOKEN ? 'Set ✓' : 'Not set ✗'}`);
      
      console.log('\n🎯 IMPORTANT ENDPOINTS:');
      console.log(`   ✓ GET  http://localhost:${port}/api/whatsapp/status`);
      console.log(`   ✓ POST http://localhost:${port}/api/whatsapp/webhook`);
      console.log(`   ✓ GET  http://localhost:${port}/health`);
      
      if (port !== preferredPort) {
        console.log(`⚠️  Note: Using port ${port} instead of ${preferredPort} due to port conflict`);
      }
    });

    return { io, server, app };

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer().catch(console.error);