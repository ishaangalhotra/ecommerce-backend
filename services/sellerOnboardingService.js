// services/sellerOnboardingService.js - Advanced Seller Onboarding System

const Seller = require('../models/Seller');
const User = require('../models/User');
const emailService = require('./emailservice');
const fileUploadService = require('./fileuploadservice');

class SellerOnboardingService {
  constructor() {
    this.onboardingSteps = [
      'business_info',
      'contact_info', 
      'address_info',
      'legal_info',
      'bank_info',
      'document_upload',
      'verification',
      'approval'
    ];
  }

  /**
   * Start seller onboarding process
   */
  async startOnboarding(userId, basicInfo) {
    try {
      // Check if user already has seller account
      const existingSeller = await Seller.findOne({ user: userId });
      if (existingSeller) {
        throw new Error('User already has a seller account');
      }

      // Create initial seller record
      const seller = new Seller({
        user: userId,
        businessInfo: {
          businessName: basicInfo.businessName,
          businessType: basicInfo.businessType,
          businessCategory: basicInfo.businessCategory,
          businessDescription: basicInfo.businessDescription
        },
        status: 'pending',
        audit: {
          createdBy: userId
        }
      });

      await seller.save();

      // Send welcome email
      const user = await User.findById(userId);
      await this.sendWelcomeEmail(user, seller);

      return {
        success: true,
        sellerId: seller._id,
        currentStep: 'business_info',
        nextStep: 'contact_info',
        completionPercentage: 12.5
      };

    } catch (error) {
      console.error('Error starting seller onboarding:', error);
      throw error;
    }
  }

  /**
   * Update onboarding step
   */
  async updateOnboardingStep(sellerId, step, data) {
    try {
      const seller = await Seller.findById(sellerId);
      if (!seller) {
        throw new Error('Seller not found');
      }

      let updateData = {};
      let isValid = true;
      let validationErrors = [];

      switch (step) {
        case 'business_info':
          updateData = { businessInfo: { ...seller.businessInfo, ...data } };
          validationErrors = this.validateBusinessInfo(data);
          break;

        case 'contact_info':
          updateData = { contactInfo: data };
          validationErrors = this.validateContactInfo(data);
          break;

        case 'address_info':
          updateData = { addresses: data };
          validationErrors = this.validateAddressInfo(data);
          break;

        case 'legal_info':
          updateData = { legalInfo: data };
          validationErrors = this.validateLegalInfo(data);
          break;

        case 'bank_info':
          updateData = { bankInfo: data };
          validationErrors = this.validateBankInfo(data);
          break;

        default:
          throw new Error('Invalid onboarding step');
      }

      if (validationErrors.length > 0) {
        return {
          success: false,
          errors: validationErrors
        };
      }

      // Update seller record
      Object.assign(seller, updateData);
      await seller.save();

      // Calculate completion percentage
      const completionPercentage = this.calculateCompletionPercentage(seller);
      const nextStep = this.getNextStep(step);

      return {
        success: true,
        currentStep: step,
        nextStep,
        completionPercentage,
        isComplete: completionPercentage === 100
      };

    } catch (error) {
      console.error('Error updating onboarding step:', error);
      throw error;
    }
  }

  /**
   * Upload and verify documents
   */
  async uploadDocument(sellerId, documentType, file) {
    try {
      const seller = await Seller.findById(sellerId);
      if (!seller) {
        throw new Error('Seller not found');
      }

      // Upload file to cloud storage
      const uploadResult = await fileUploadService.uploadFile(file, {
        folder: `sellers/${sellerId}/documents`,
        resource_type: 'auto'
      });

      // Add document to seller record
      const document = {
        type: documentType,
        url: uploadResult.secure_url,
        filename: file.originalname,
        uploadedAt: new Date(),
        status: 'pending'
      };

      seller.kyc.documents.push(document);
      await seller.save();

      // Auto-verify certain documents if possible
      const verificationResult = await this.autoVerifyDocument(document);

      return {
        success: true,
        document: {
          ...document,
          ...verificationResult
        }
      };

    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  }

  /**
   * Submit for verification
   */
  async submitForVerification(sellerId) {
    try {
      const seller = await Seller.findById(sellerId).populate('user');
      if (!seller) {
        throw new Error('Seller not found');
      }

      // Check if all required steps are completed
      const completionCheck = this.checkCompletionRequirements(seller);
      if (!completionCheck.isComplete) {
        return {
          success: false,
          message: 'Please complete all required information',
          missingRequirements: completionCheck.missing
        };
      }

      // Update status to verification
      seller.kyc.status = 'in_progress';
      seller.kyc.lastVerificationAttempt = new Date();
      seller.status = 'pending';

      await seller.save();

      // Notify admin team
      await this.notifyAdminForVerification(seller);

      // Send confirmation email to seller
      await this.sendVerificationSubmittedEmail(seller.user, seller);

      return {
        success: true,
        message: 'Application submitted for verification',
        estimatedVerificationTime: '2-3 business days'
      };

    } catch (error) {
      console.error('Error submitting for verification:', error);
      throw error;
    }
  }

  /**
   * Verify seller (Admin function)
   */
  async verifySeller(sellerId, adminId, decision, notes = '') {
    try {
      const seller = await Seller.findById(sellerId).populate('user');
      if (!seller) {
        throw new Error('Seller not found');
      }

      if (decision === 'approved') {
        seller.kyc.status = 'verified';
        seller.kyc.verifiedAt = new Date();
        seller.kyc.verifiedBy = adminId;
        seller.status = 'active';

        // Add verified badge
        await seller.addBadge('verified');

        // Send approval email
        await this.sendApprovalEmail(seller.user, seller);

        // Setup default business settings
        await this.setupDefaultBusinessSettings(seller);

      } else if (decision === 'rejected') {
        seller.kyc.status = 'rejected';
        seller.kyc.rejectionReason = notes;
        seller.status = 'rejected';

        // Send rejection email
        await this.sendRejectionEmail(seller.user, seller, notes);
      }

      await seller.save();

      return {
        success: true,
        status: seller.status,
        message: `Seller ${decision} successfully`
      };

    } catch (error) {
      console.error('Error verifying seller:', error);
      throw error;
    }
  }

  /**
   * Get onboarding status
   */
  async getOnboardingStatus(sellerId) {
    try {
      const seller = await Seller.findById(sellerId);
      if (!seller) {
        throw new Error('Seller not found');
      }

      const completionPercentage = this.calculateCompletionPercentage(seller);
      const currentStep = this.getCurrentStep(seller);
      const nextStep = this.getNextStep(currentStep);

      return {
        sellerId: seller._id,
        status: seller.status,
        kycStatus: seller.kyc.status,
        currentStep,
        nextStep,
        completionPercentage,
        isComplete: completionPercentage === 100,
        steps: this.getStepStatus(seller)
      };

    } catch (error) {
      console.error('Error getting onboarding status:', error);
      throw error;
    }
  }

  // Validation Methods
  validateBusinessInfo(data) {
    const errors = [];
    
    if (!data.businessName || data.businessName.trim().length < 2) {
      errors.push('Business name must be at least 2 characters long');
    }
    
    if (!data.businessType) {
      errors.push('Business type is required');
    }
    
    if (!data.businessCategory) {
      errors.push('Business category is required');
    }
    
    return errors;
  }

  validateContactInfo(data) {
    const errors = [];
    
    if (!data.primaryPhone || !/^\+?[\d\s\-\(\)]+$/.test(data.primaryPhone)) {
      errors.push('Valid primary phone number is required');
    }
    
    if (!data.email || !/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(data.email)) {
      errors.push('Valid email address is required');
    }
    
    return errors;
  }

  validateAddressInfo(data) {
    const errors = [];
    
    if (!data.business || !data.business.street) {
      errors.push('Business street address is required');
    }
    
    if (!data.business || !data.business.city) {
      errors.push('Business city is required');
    }
    
    if (!data.business || !data.business.pincode) {
      errors.push('Business pincode is required');
    }
    
    return errors;
  }

  validateLegalInfo(data) {
    const errors = [];
    
    if (!data.pan || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(data.pan)) {
      errors.push('Valid PAN number is required');
    }
    
    if (data.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(data.gstin)) {
      errors.push('Invalid GSTIN format');
    }
    
    return errors;
  }

  validateBankInfo(data) {
    const errors = [];
    
    if (!data.accountHolderName) {
      errors.push('Account holder name is required');
    }
    
    if (!data.accountNumber || !/^[0-9]{9,18}$/.test(data.accountNumber)) {
      errors.push('Valid account number is required');
    }
    
    if (!data.ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(data.ifscCode)) {
      errors.push('Valid IFSC code is required');
    }
    
    return errors;
  }

  // Helper Methods
  calculateCompletionPercentage(seller) {
    let completed = 0;
    const total = this.onboardingSteps.length;

    // Check each step completion
    if (seller.businessInfo && seller.businessInfo.businessName) completed++;
    if (seller.contactInfo && seller.contactInfo.primaryPhone) completed++;
    if (seller.addresses && seller.addresses.business && seller.addresses.business.street) completed++;
    if (seller.legalInfo && seller.legalInfo.pan) completed++;
    if (seller.bankInfo && seller.bankInfo.accountNumber) completed++;
    if (seller.kyc.documents && seller.kyc.documents.length > 0) completed++;
    if (seller.kyc.status === 'in_progress' || seller.kyc.status === 'verified') completed++;
    if (seller.status === 'active') completed++;

    return Math.round((completed / total) * 100);
  }

  getCurrentStep(seller) {
    if (!seller.businessInfo || !seller.businessInfo.businessName) return 'business_info';
    if (!seller.contactInfo || !seller.contactInfo.primaryPhone) return 'contact_info';
    if (!seller.addresses || !seller.addresses.business) return 'address_info';
    if (!seller.legalInfo || !seller.legalInfo.pan) return 'legal_info';
    if (!seller.bankInfo || !seller.bankInfo.accountNumber) return 'bank_info';
    if (!seller.kyc.documents || seller.kyc.documents.length === 0) return 'document_upload';
    if (seller.kyc.status === 'pending') return 'verification';
    return 'approval';
  }

  getNextStep(currentStep) {
    const currentIndex = this.onboardingSteps.indexOf(currentStep);
    if (currentIndex < this.onboardingSteps.length - 1) {
      return this.onboardingSteps[currentIndex + 1];
    }
    return null;
  }

  getStepStatus(seller) {
    return this.onboardingSteps.map(step => ({
      step,
      completed: this.isStepCompleted(seller, step),
      current: this.getCurrentStep(seller) === step
    }));
  }

  isStepCompleted(seller, step) {
    switch (step) {
      case 'business_info':
        return !!(seller.businessInfo && seller.businessInfo.businessName);
      case 'contact_info':
        return !!(seller.contactInfo && seller.contactInfo.primaryPhone);
      case 'address_info':
        return !!(seller.addresses && seller.addresses.business);
      case 'legal_info':
        return !!(seller.legalInfo && seller.legalInfo.pan);
      case 'bank_info':
        return !!(seller.bankInfo && seller.bankInfo.accountNumber);
      case 'document_upload':
        return !!(seller.kyc.documents && seller.kyc.documents.length > 0);
      case 'verification':
        return seller.kyc.status === 'in_progress' || seller.kyc.status === 'verified';
      case 'approval':
        return seller.status === 'active';
      default:
        return false;
    }
  }

  checkCompletionRequirements(seller) {
    const missing = [];

    if (!seller.businessInfo || !seller.businessInfo.businessName) {
      missing.push('Business information');
    }
    if (!seller.contactInfo || !seller.contactInfo.primaryPhone) {
      missing.push('Contact information');
    }
    if (!seller.addresses || !seller.addresses.business) {
      missing.push('Address information');
    }
    if (!seller.legalInfo || !seller.legalInfo.pan) {
      missing.push('Legal information');
    }
    if (!seller.bankInfo || !seller.bankInfo.accountNumber) {
      missing.push('Bank information');
    }
    if (!seller.kyc.documents || seller.kyc.documents.length < 2) {
      missing.push('Required documents (minimum 2)');
    }

    return {
      isComplete: missing.length === 0,
      missing
    };
  }

  async autoVerifyDocument(document) {
    // Placeholder for auto-verification logic
    // In production, integrate with services like:
    // - PAN verification API
    // - GSTIN verification API
    // - Bank account verification API
    
    return {
      autoVerified: false,
      confidence: 0,
      extractedData: {}
    };
  }

  async setupDefaultBusinessSettings(seller) {
    // Set up default operating hours
    const defaultHours = [
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
    ].map(day => ({
      day,
      isOpen: true,
      openTime: '09:00',
      closeTime: '21:00'
    }));

    defaultHours.push({
      day: 'sunday',
      isOpen: false,
      openTime: '10:00',
      closeTime: '18:00'
    });

    seller.businessSettings.operatingHours = defaultHours;

    // Set up default shipping methods
    seller.shipping.methods = [{
      name: 'Standard Delivery',
      type: 'standard',
      cost: 50,
      freeShippingThreshold: 500,
      estimatedDays: 2,
      isActive: true
    }];

    await seller.save();
  }

  // Email Methods
  async sendWelcomeEmail(user, seller) {
    const emailData = {
      to: user.email,
      subject: 'Welcome to QuickLocal Marketplace!',
      template: 'seller_welcome',
      data: {
        sellerName: user.name,
        businessName: seller.businessInfo.businessName,
        onboardingUrl: `${process.env.FRONTEND_URL}/seller/onboarding/${seller._id}`
      }
    };

    await emailService.sendEmail(emailData);
  }

  async sendVerificationSubmittedEmail(user, seller) {
    const emailData = {
      to: user.email,
      subject: 'Seller Application Submitted for Verification',
      template: 'seller_verification_submitted',
      data: {
        sellerName: user.name,
        businessName: seller.businessInfo.businessName,
        estimatedTime: '2-3 business days'
      }
    };

    await emailService.sendEmail(emailData);
  }

  async sendApprovalEmail(user, seller) {
    const emailData = {
      to: user.email,
      subject: 'Congratulations! Your Seller Account is Approved',
      template: 'seller_approved',
      data: {
        sellerName: user.name,
        businessName: seller.businessInfo.businessName,
        dashboardUrl: `${process.env.FRONTEND_URL}/seller/dashboard`
      }
    };

    await emailService.sendEmail(emailData);
  }

  async sendRejectionEmail(user, seller, reason) {
    const emailData = {
      to: user.email,
      subject: 'Seller Application Update Required',
      template: 'seller_rejected',
      data: {
        sellerName: user.name,
        businessName: seller.businessInfo.businessName,
        rejectionReason: reason,
        reapplyUrl: `${process.env.FRONTEND_URL}/seller/onboarding/${seller._id}`
      }
    };

    await emailService.sendEmail(emailData);
  }

  async notifyAdminForVerification(seller) {
    // Send notification to admin team
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [];
    
    for (const email of adminEmails) {
      const emailData = {
        to: email,
        subject: 'New Seller Application for Verification',
        template: 'admin_seller_verification',
        data: {
          businessName: seller.businessInfo.businessName,
          sellerEmail: seller.contactInfo.email,
          verificationUrl: `${process.env.ADMIN_URL}/sellers/verify/${seller._id}`
        }
      };

      await emailService.sendEmail(emailData);
    }
  }
}

module.exports = new SellerOnboardingService();
