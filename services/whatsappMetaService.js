// services/whatsappMetaService.js - UPDATED WITH DATABASE FUNCTIONS
import axios from 'axios';
import { pool } from '../databaseconfig.js';

class WhatsAppMetaService {
  constructor() {
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    this.templates = new Map();
  }

  async sendMessage(to, message, templateName = null, language = 'en') {
    try {
      const formattedTo = this.formatPhoneNumber(to);
      if (!formattedTo) {
        console.warn('Invalid phone number:', to);
        return { success: false, error: 'Invalid phone number' };
      }

      let payload;
      
      if (templateName) {
        // Get template from database
        const template = await this.getTemplate(templateName);
        if (!template) {
          return { success: false, error: `Template "${templateName}" not found` };
        }
        
        payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedTo,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: language
            }
          }
        };
      } else {
        payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedTo,
          type: 'text',
          text: {
            preview_url: false,
            body: message
          }
        };
      }

      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`WhatsApp message sent to ${formattedTo}:`, response.data);
      
      // Log success
      await this.logMessage(to, message, templateName, true, response.data.messages[0].id);
      
      return { 
        success: true, 
        messageId: response.data.messages[0].id,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Error sending WhatsApp message:', error.response?.data || error.message);
      
      // Log failure
      await this.logMessage(to, message, templateName, false, null, error.message);
      
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        code: error.response?.data?.error?.code
      };
    }
  }

  async sendTemplateMessage(to, templateName, components = [], language = 'en') {
    try {
      const formattedTo = this.formatPhoneNumber(to);
      if (!formattedTo) {
        console.warn('Invalid phone number:', to);
        return { success: false, error: 'Invalid phone number' };
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedTo,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: language
          },
          components: components.length > 0 ? components : undefined
        }
      };

      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`WhatsApp template sent to ${formattedTo}:`, response.data);
      
      // Log success
      await this.logMessage(to, `Template: ${templateName}`, templateName, true, response.data.messages[0].id);
      
      return { 
        success: true, 
        messageId: response.data.messages[0].id,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Error sending WhatsApp template:', error.response?.data || error.message);
      
      // Log failure
      await this.logMessage(to, `Template: ${templateName}`, templateName, false, null, error.message);
      
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  formatPhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Add country code if missing
    if (cleaned.length === 10) {
      return `91${cleaned}`; // India
    }
    
    if (cleaned.length === 12 && cleaned.startsWith('91')) {
      return cleaned;
    }
    
    // For international numbers starting with +
    if (phone.startsWith('+')) {
      return phone.replace('+', '');
    }
    
    return cleaned;
  }

  async logMessage(recipient, message, templateName, success, messageId, error = null) {
    try {
      await pool.execute(
        `INSERT INTO whatsapp_messages 
         (recipient, message, template_name, success, message_id, error_message, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'meta', NOW())`,
        [
          recipient,
          message,
          templateName,
          success ? 1 : 0,
          messageId,
          error,
        ]
      );
    } catch (dbError) {
      console.error('Error logging WhatsApp message:', dbError);
    }
  }

  async getTemplate(templateName) {
    try {
      // Check cache first
      if (this.templates.has(templateName)) {
        return this.templates.get(templateName);
      }
      
      // Get from database
      const [templates] = await pool.execute(
        `SELECT * FROM whatsapp_templates WHERE name = ? AND status = 'active'`,
        [templateName]
      );
      
      if (templates.length > 0) {
        this.templates.set(templateName, templates[0]);
        return templates[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error getting template:', error);
      return null;
    }
  }

  async sendBookingConfirmation(bookingId) {
    try {
      const [booking] = await pool.query(
        `SELECT 
          b.id,
          b.appointment_time,
          b.meeting_link,
          c.name AS client_name,
          c.phone AS client_phone,
          d.name AS doctor_name,
          d.PhoneNumber AS doctor_phone
        FROM bookings b
        JOIN clientinfo c ON b.client_id = c.id
        JOIN docinfo d ON b.doctor_id = d.id
        WHERE b.id = ?`, 
        [bookingId]
      );

      if (!booking || booking.length === 0) {
        console.warn(`Booking ${bookingId} not found`);
        return { success: false, error: 'Booking not found' };
      }

      const bookingData = booking[0];
      const appointmentDate = new Date(bookingData.appointment_time);
      
      // Format date for template
      const formattedDate = appointmentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      
      const formattedTime = appointmentDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

      // Send to client using template
      const clientComponents = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: bookingData.client_name },
            { type: 'text', text: `Dr. ${bookingData.doctor_name}` },
            { type: 'text', text: formattedDate },
            { type: 'text', text: formattedTime },
            { type: 'text', text: bookingData.meeting_link || 'Will be shared later' }
          ]
        }
      ];

      // Send to doctor
      const doctorComponents = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: bookingData.doctor_name },
            { type: 'text', text: bookingData.client_name },
            { type: 'text', text: formattedDate },
            { type: 'text', text: formattedTime },
            { type: 'text', text: bookingData.client_phone || 'No phone' }
          ]
        }
      ];

      const results = {};
      
      // Send to client
      if (bookingData.client_phone) {
        results.client = await this.sendTemplateMessage(
          bookingData.client_phone,
          'booking_confirmation',
          clientComponents
        );
      }
      
      // Send to doctor
      if (bookingData.doctor_phone) {
        results.doctor = await this.sendTemplateMessage(
          bookingData.doctor_phone,
          'booking_confirmation_doctor',
          doctorComponents
        );
      }

      // Update booking
      await pool.query(
        `UPDATE bookings SET confirmation_sent = 1, whatsapp_confirmation_sent = NOW() WHERE id = ?`,
        [bookingId]
      );

      return {
        success: true,
        details: results,
        bookingId
      };

    } catch (error) {
      console.error('Error in sendBookingConfirmation:', error);
      
      // Log error
      await this.logMessage(
        'booking_system', 
        `Booking confirmation failed for ${bookingId}`, 
        'booking_confirmation', 
        false, 
        null, 
        error.message
      );
      
      return { success: false, error: error.message };
    }
  }

  async sendSessionReminder(bookingId) {
    try {
      const [booking] = await pool.query(
        `SELECT 
          b.id,
          b.appointment_time,
          b.meeting_link,
          c.name AS client_name,
          c.phone AS client_phone,
          d.name AS doctor_name,
          d.PhoneNumber AS doctor_phone
        FROM bookings b
        JOIN clientinfo c ON b.client_id = c.id
        JOIN docinfo d ON b.doctor_id = d.id
        WHERE b.id = ? AND b.status = 'scheduled'`, 
        [bookingId]
      );

      if (!booking || booking.length === 0) {
        console.warn(`Booking ${bookingId} not found`);
        return { success: false, error: 'Booking not found' };
      }

      const bookingData = booking[0];
      const appointmentDate = new Date(bookingData.appointment_time);
      const now = new Date();
      const minutesUntil = Math.floor((appointmentDate - now) / (1000 * 60));

      // Don't send if less than 5 minutes or more than 65 minutes
      if (minutesUntil < 5 || minutesUntil > 65) {
        console.log(`Skipping reminder for booking ${bookingId}: ${minutesUntil} minutes until appointment`);
        return { success: false, error: 'Outside reminder window' };
      }

      const formattedTime = appointmentDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

      // Send to client
      const clientMessage = `🔔 Reminder: Your session with Dr. ${bookingData.doctor_name} is in ${minutesUntil} minutes.\n\nTime: ${formattedTime}\n${bookingData.meeting_link ? `Meeting Link: ${bookingData.meeting_link}` : 'Your therapist will call you shortly.'}\n\nPlease be ready in a quiet space with good internet connection.`;

      // Send to doctor
      const doctorMessage = `🔔 Reminder: Your session with ${bookingData.client_name} is in ${minutesUntil} minutes.\n\nTime: ${formattedTime}\nClient Contact: ${bookingData.client_phone || 'No phone provided'}\n\nPlease review client notes and be prepared.`;

      const results = {};
      
      if (bookingData.client_phone) {
        results.client = await this.sendMessage(bookingData.client_phone, clientMessage);
      }
      
      if (bookingData.doctor_phone) {
        results.doctor = await this.sendMessage(bookingData.doctor_phone, doctorMessage);
      }

      // Update booking
      await pool.query(
        `UPDATE bookings SET reminder_sent = 1, whatsapp_reminder_sent = NOW() WHERE id = ?`,
        [bookingId]
      );

      return {
        success: true,
        details: results,
        minutesUntil,
        bookingId
      };

    } catch (error) {
      console.error('Error in sendSessionReminder:', error);
      
      // Log error
      await this.logMessage(
        'booking_system', 
        `Session reminder failed for ${bookingId}`, 
        'session_reminder', 
        false, 
        null, 
        error.message
      );
      
      return { success: false, error: error.message };
    }
  }

  // Initialize WhatsApp templates in database
  async initializeTemplates() {
    try {
      console.log('Initializing WhatsApp templates...');
      
      const defaultTemplates = [
        {
          name: 'booking_confirmation',
          category: 'UTILITY',
          language: 'en',
          components: JSON.stringify({
            body: "Hello {1}, your appointment with {2} is confirmed for {3} at {4}. Meeting Link: {5}"
          })
        },
        {
          name: 'booking_confirmation_doctor',
          category: 'UTILITY',
          language: 'en',
          components: JSON.stringify({
            body: "Hello Dr. {1}, you have a new appointment with {2} on {3} at {4}. Client Contact: {5}"
          })
        },
        {
          name: 'session_reminder',
          category: 'UTILITY',
          language: 'en',
          components: JSON.stringify({
            body: "Reminder: Your appointment is in {1} minutes at {2}"
          })
        },
        {
          name: 'appointment_cancelled',
          category: 'UTILITY',
          language: 'en',
          components: JSON.stringify({
            body: "Your appointment with {1} on {2} has been cancelled. Contact support for rescheduling."
          })
        },
        {
          name: 'welcome_message',
          category: 'UTILITY',
          language: 'en',
          components: JSON.stringify({
            body: "Welcome to Uxaah! We're glad to have you. Book your first session at https://uxaah.com"
          })
        }
      ];
      
      for (const template of defaultTemplates) {
        const [existing] = await pool.execute(
          `SELECT id FROM whatsapp_templates WHERE name = ?`,
          [template.name]
        );
        
        if (existing.length === 0) {
          await pool.execute(
            `INSERT INTO whatsapp_templates (name, category, language, components, status, created_at)
             VALUES (?, ?, ?, ?, 'active', NOW())`,
            [
              template.name,
              template.category,
              template.language,
              template.components
            ]
          );
          console.log(`Created template: ${template.name}`);
        } else {
          console.log(`Template already exists: ${template.name}`);
        }
      }
      
      console.log('WhatsApp templates initialized successfully');
      
    } catch (error) {
      console.error('Error initializing WhatsApp templates:', error);
    }
  }
}

export const whatsappMetaService = new WhatsAppMetaService();
export const initializeWhatsAppTemplates = () => whatsappMetaService.initializeTemplates();