// services/whatsappHybridService.js
import { whatsappMetaService } from './whatsappMetaService.js';

class HybridWhatsAppService {
  constructor() {
    this.providers = ['meta']; // Start with Meta
    this.currentProvider = 0;
  }

  async sendMessage(to, message, options = {}) {
    let lastError;
    
    // Try all providers in order
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const provider = this.providers[i];
        
        if (provider === 'meta') {
          if (options.templateName) {
            const result = await whatsappMetaService.sendTemplateMessage(
              to, 
              options.templateName, 
              options.components || []
            );
            if (result.success) return result;
            lastError = result.error;
          } else {
            const result = await whatsappMetaService.sendMessage(to, message);
            if (result.success) return result;
            lastError = result.error;
          }
        }
        
        // Add more providers here as needed
        // else if (provider === 'twilio') {
        //   // Use Twilio service
        // }
        
      } catch (error) {
        lastError = error.message;
        console.warn(`Provider ${this.providers[i]} failed:`, error.message);
      }
    }
    
    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`
    };
  }

  // Use cheapest provider first based on message type
  getProviderPriority(messageType) {
    const priorities = {
      'template': ['meta'], // Meta is better for templates
      'text': ['meta'], // Meta for text messages
      'media': ['meta'] // Meta handles media better
    };
    
    return priorities[messageType] || this.providers;
  }

  async sendTemplate(to, templateName, components = []) {
    return this.sendMessage(to, '', {
      templateName,
      components,
      messageType: 'template'
    });
  }
}

export const hybridService = new HybridWhatsAppService();