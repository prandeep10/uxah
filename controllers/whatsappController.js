// controllers/whatsappController.js
import { pool } from '../databaseconfig.js';
import { whatsappMetaService } from '../services/whatsappMetaService.js';
import { hybridService } from '../services/whatsappHybridService.js';

// Send WhatsApp message
export const sendWhatsAppMessage = async (req, res) => {
  try {
    const { to, message, templateName, templateVariables } = req.body;
    const userId = req.user.id;
    
    if (!to || (!message && !templateName)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields. Provide either message or templateName'
      });
    }
    
    // Determine which service to use
    const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'meta';
    let result;
    
    if (whatsappProvider === 'meta' && templateName) {
      // Use Meta template
      const components = templateVariables ? [
        {
          type: 'body',
          parameters: templateVariables.map(varText => ({
            type: 'text',
            text: varText
          }))
        }
      ] : [];
      
      result = await whatsappMetaService.sendTemplateMessage(
        to, 
        templateName, 
        components
      );
    } else if (whatsappProvider === 'hybrid') {
      // Use hybrid service
      result = await hybridService.sendMessage(to, message, { templateName });
    } else {
      // Use Meta text message
      result = await whatsappMetaService.sendMessage(to, message);
    }
    
    // Log the message
    await pool.execute(
      `INSERT INTO whatsapp_messages 
       (user_id, recipient, message, template_name, success, message_id, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        to,
        message || templateName,
        templateName || null,
        result.success ? 1 : 0,
        result.messageId || null,
        whatsappProvider
      ]
    );
    
    if (result.success) {
      res.json({
        success: true,
        messageId: result.messageId,
        message: 'WhatsApp message sent successfully',
        provider: whatsappProvider
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        provider: whatsappProvider
      });
    }
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Send test message
export const sendTestMessage = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const userId = req.user.id;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    const testMessage = `🔔 Test Message from Uxaah\n\nHello! This is a test message from your Uxaah application.\n\nTimestamp: ${new Date().toLocaleString()}\nStatus: ✅ Working correctly\n\nIf you received this, your WhatsApp integration is set up correctly!`;
    
    const result = await whatsappMetaService.sendMessage(phoneNumber, testMessage);
    
    // Log the test message
    await pool.execute(
      `INSERT INTO whatsapp_messages 
       (user_id, recipient, message, template_name, success, message_id, provider, is_test, created_at)
       VALUES (?, ?, ?, 'test_message', ?, ?, ?, 1, NOW())`,
      [
        userId,
        phoneNumber,
        testMessage,
        result.success ? 1 : 0,
        result.messageId || null,
        process.env.WHATSAPP_PROVIDER || 'meta'
      ]
    );
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test message sent successfully',
        messageId: result.messageId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        details: 'Check your WhatsApp API configuration'
      });
    }
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get WhatsApp templates
export const getWhatsAppTemplates = async (req, res) => {
  try {
    const [templates] = await pool.execute(
      `SELECT * FROM whatsapp_templates WHERE status = 'active' ORDER BY created_at DESC`
    );
    
    res.json({
      success: true,
      templates: templates,
      count: templates.length
    });
  } catch (error) {
    console.error('Error getting WhatsApp templates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Create WhatsApp template
export const createWhatsAppTemplate = async (req, res) => {
  try {
    const { name, category, language, components } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({
        success: false,
        error: 'Name and category are required'
      });
    }
    
    await pool.execute(
      `INSERT INTO whatsapp_templates (name, category, language, components, status, created_at)
       VALUES (?, ?, ?, ?, 'active', NOW())`,
      [
        name,
        category,
        language || 'en',
        JSON.stringify(components || {})
      ]
    );
    
    res.json({
      success: true,
      message: 'Template created successfully',
      templateName: name
    });
  } catch (error) {
    console.error('Error creating WhatsApp template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get message status
export const getMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const [messages] = await pool.execute(
      `SELECT * FROM whatsapp_messages WHERE message_id = ?`,
      [messageId]
    );
    
    if (messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
    
    const message = messages[0];
    
    // If using Meta API, you could fetch real-time status here
    // For now, return stored status
    
    res.json({
      success: true,
      message: {
        id: message.id,
        messageId: message.message_id,
        recipient: message.recipient,
        status: message.success ? 'delivered' : 'failed',
        sentAt: message.created_at,
        provider: message.provider
      }
    });
  } catch (error) {
    console.error('Error getting message status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Handle WhatsApp webhook
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    console.log('WhatsApp webhook received:', req.body);
    
    // Verify webhook subscription
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_WEBHOOK_TOKEN) {
      console.log('Webhook verified successfully');
      return res.send(req.query['hub.challenge']);
    }
    
    // Handle incoming messages
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
      const messages = req.body.entry[0].changes[0].value.messages;
      
      for (const message of messages) {
        console.log('Processing incoming message:', message);
        
        // Log incoming message
        await pool.execute(
          `INSERT INTO whatsapp_incoming_messages 
           (message_id, from_number, message_type, message_text, timestamp, received_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            message.id,
            message.from,
            message.type,
            message.type === 'text' ? message.text.body : message.type,
            new Date(message.timestamp * 1000)
          ]
        );
        
        // Handle different message types
        if (message.type === 'text') {
          // Handle text messages (e.g., support queries)
          await handleTextMessage(message);
        }
      }
    }
    
    // Handle status updates
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.statuses) {
      const statuses = req.body.entry[0].changes[0].value.statuses;
      
      for (const status of statuses) {
        console.log('Message status update:', status);
        
        // Update message status in database
        await pool.execute(
          `UPDATE whatsapp_messages 
           SET status = ?, updated_at = NOW()
           WHERE message_id = ?`,
          [
            status.status,
            status.id
          ]
        );
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Error processing webhook');
  }
};

// Helper function to handle incoming text messages
const handleTextMessage = async (message) => {
  try {
    const text = message.text.body.toLowerCase();
    const fromNumber = message.from;
    
    // Example: Handle "help" command
    if (text.includes('help') || text.includes('support')) {
      const helpMessage = `🤖 Uxaah Support\n\nHow can I help you?\n\n1. Type "booking" for booking help\n2. Type "doctor" for doctor info\n3. Type "cancel" to cancel a booking\n4. Type "support" to talk to a human\n\nOr visit: https://uxaah.com`;
      
      await whatsappMetaService.sendMessage(fromNumber, helpMessage);
    }
    
    // Example: Handle "booking" command
    if (text.includes('booking')) {
      const bookingMessage = `📅 Booking Information\n\nTo book a session:\n1. Visit https://uxaah.com\n2. Choose a therapist\n3. Select available time\n4. Confirm booking\n\nYou'll receive confirmation via WhatsApp.`;
      
      await whatsappMetaService.sendMessage(fromNumber, bookingMessage);
    }
    
  } catch (error) {
    console.error('Error handling text message:', error);
  }
};

// Get WhatsApp analytics
export const getWhatsAppAnalytics = async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_messages,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN is_test = 1 THEN 1 ELSE 0 END) as test_messages
      FROM whatsapp_messages 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    const [recentMessages] = await pool.execute(`
      SELECT 
        wm.*,
        COALESCE(u.Name, d.name) as sender_name
      FROM whatsapp_messages wm
      LEFT JOIN users u ON wm.user_id = u.id
      LEFT JOIN docinfo d ON wm.user_id = d.id
      ORDER BY wm.created_at DESC
      LIMIT 20
    `);
    
    res.json({
      success: true,
      analytics: {
        dailyStats: stats,
        recentMessages: recentMessages,
        totalMessages: stats.reduce((sum, day) => sum + day.total_messages, 0),
        successRate: stats.length > 0 
          ? ((stats.reduce((sum, day) => sum + day.successful, 0) / 
              stats.reduce((sum, day) => sum + day.total_messages, 0)) * 100).toFixed(2) + '%'
          : '0%'
      }
    });
  } catch (error) {
    console.error('Error getting WhatsApp analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};