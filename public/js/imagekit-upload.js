/**
 * ImageKit Direct Upload Utility
 * MEMORY OPTIMIZED: Uploads directly to ImageKit, bypassing server memory
 * 
 * Usage:
 *   const uploader = new ImageKitUploader();
 *   const result = await uploader.uploadFile(file, { folder: '/products' });
 */

class ImageKitUploader {
  constructor() {
    this.apiBase = window.APP_CONFIG?.API_BASE_URL || '/api';
    this.maxFileSize = 5 * 1024 * 1024; // 5MB
    this.allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  }

  /**
   * Upload file directly to ImageKit (bypasses server memory)
   * @param {File} file - The file to upload
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(file, options = {}) {
    try {
      // Client-side validation to prevent server load
      this.validateFile(file);

      // Step 1: Get signature from backend (minimal memory impact)
      const signature = await this.getSignature();
      
      // Step 2: Upload directly to ImageKit (bypasses server entirely)
      const uploadResult = await this.uploadToImageKit(file, signature, options);
      
      // Step 3: Save metadata to backend (minimal payload)
      const metadata = await this.saveMetadata(uploadResult);
      
      return {
        success: true,
        image: metadata.image,
        message: 'Image uploaded successfully'
      };

    } catch (error) {
      console.error('ImageKit upload failed:', error);
      throw new Error(error.message || 'Upload failed');
    }
  }

  /**
   * Validate file on client-side to prevent server load
   * @param {File} file - File to validate
   */
  validateFile(file) {
    if (!file) {
      throw new Error('No file provided');
    }

    if (file.size > this.maxFileSize) {
      throw new Error(`File too large. Maximum size: ${this.maxFileSize / 1024 / 1024}MB`);
    }

    if (!this.allowedTypes.includes(file.type)) {
      throw new Error(`Invalid file type. Allowed: ${this.allowedTypes.join(', ')}`);
    }
  }

  /**
   * Get upload signature from backend
   * Memory impact: ~100 bytes per request
   * @returns {Promise<Object>} Signature data
   */
  async getSignature() {
    const token = localStorage.getItem('quicklocal_access_token');
    
    const response = await fetch(`${this.apiBase}/v1/imagekit/sign`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get upload signature');
    }

    return await response.json();
  }

  /**
   * Upload directly to ImageKit (bypasses server memory)
   * @param {File} file - File to upload
   * @param {Object} signature - Upload signature
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} ImageKit response
   */
  async uploadToImageKit(file, signature, options) {
    const formData = new FormData();
    
    // Required ImageKit fields
    formData.append('file', file);
    formData.append('signature', signature.signature);
    formData.append('timestamp', signature.timestamp);
    formData.append('publicKey', signature.publicKey);
    
    // Optional fields
    if (options.folder || signature.folder) {
      formData.append('folder', options.folder || signature.folder);
    }
    
    if (options.tags) {
      formData.append('tags', Array.isArray(options.tags) ? options.tags.join(',') : options.tags);
    }
    
    // File name
    const fileName = options.fileName || file.name || `upload_${Date.now()}`;
    formData.append('fileName', fileName);

    // Upload to ImageKit directly
    const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'ImageKit upload failed');
    }

    return await response.json();
  }

  /**
   * Save image metadata to backend after successful upload
   * Memory impact: Minimal - only metadata, no file data
   * @param {Object} uploadResult - ImageKit upload result
   * @returns {Promise<Object>} Metadata save result
   */
  async saveMetadata(uploadResult) {
    const token = localStorage.getItem('quicklocal_access_token');
    
    const metadata = {
      fileId: uploadResult.fileId,
      name: uploadResult.name,
      url: uploadResult.url,
      size: uploadResult.size,
      tags: uploadResult.tags || []
    };

    const response = await fetch(`${this.apiBase}/v1/imagekit/metadata`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to save image metadata');
    }

    return await response.json();
  }

  /**
   * Create file input element with validation
   * @param {Object} options - Input options
   * @returns {HTMLInputElement} File input element
   */
  createFileInput(options = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.allowedTypes.join(',');
    input.multiple = options.multiple || false;
    
    // Add client-side validation
    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        try {
          this.validateFile(file);
        } catch (error) {
          alert(`File validation failed: ${error.message}`);
          e.target.value = ''; // Clear invalid selection
        }
      });
    });

    return input;
  }

  /**
   * Create upload button with progress
   * @param {Object} options - Button options
   * @returns {Object} Upload button and progress elements
   */
  createUploadButton(options = {}) {
    const container = document.createElement('div');
    container.className = 'imagekit-upload-container';
    
    const button = document.createElement('button');
    button.textContent = options.text || 'Upload Image';
    button.className = 'imagekit-upload-btn';
    
    const progress = document.createElement('div');
    progress.className = 'imagekit-progress';
    progress.style.display = 'none';
    progress.innerHTML = '<div class="imagekit-progress-bar"></div><span class="imagekit-progress-text">0%</span>';
    
    const input = this.createFileInput(options);
    
    button.addEventListener('click', () => input.click());
    
    input.addEventListener('change', async (e) => {
      if (!e.target.files.length) return;
      
      const file = e.target.files[0];
      
      try {
        // Show progress
        progress.style.display = 'block';
        button.disabled = true;
        
        // Update progress (simulated)
        this.updateProgress(progress, 10, 'Getting signature...');
        
        const result = await this.uploadFile(file, options);
        
        this.updateProgress(progress, 100, 'Upload complete!');
        
        // Trigger success callback
        if (options.onSuccess) {
          options.onSuccess(result);
        }
        
        // Hide progress after delay
        setTimeout(() => {
          progress.style.display = 'none';
          button.disabled = false;
        }, 2000);
        
      } catch (error) {
        // Show error
        progress.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
        button.disabled = false;
        
        if (options.onError) {
          options.onError(error);
        }
      }
    });
    
    container.appendChild(button);
    container.appendChild(input);
    container.appendChild(progress);
    
    return { container, button, input, progress };
  }

  /**
   * Update progress display
   * @param {HTMLElement} progress - Progress element
   * @param {number} percent - Progress percentage
   * @param {string} text - Progress text
   */
  updateProgress(progress, percent, text) {
    const bar = progress.querySelector('.imagekit-progress-bar');
    const textEl = progress.querySelector('.imagekit-progress-text');
    
    if (bar) bar.style.width = `${percent}%`;
    if (textEl) textEl.textContent = text || `${percent}%`;
  }
}

// Global instance
window.ImageKitUploader = ImageKitUploader;

// Auto-initialize if needed
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Auto-enhance any existing file inputs with data-imagekit attribute
    document.querySelectorAll('input[type="file"][data-imagekit]').forEach(input => {
      const uploader = new ImageKitUploader();
      
      input.addEventListener('change', async (e) => {
        if (!e.target.files.length) return;
        
        const file = e.target.files[0];
        const options = JSON.parse(input.dataset.imagekit || '{}');
        
        try {
          const result = await uploader.uploadFile(file, options);
          
          // Trigger custom event
          input.dispatchEvent(new CustomEvent('imagekit:success', {
            detail: result
          }));
          
        } catch (error) {
          input.dispatchEvent(new CustomEvent('imagekit:error', {
            detail: error
          }));
        }
      });
    });
  });
}

/* CSS for upload components */
const style = document.createElement('style');
style.textContent = `
  .imagekit-upload-container {
    display: inline-block;
    position: relative;
  }
  
  .imagekit-upload-btn {
    background: #007bff;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  
  .imagekit-upload-btn:hover:not(:disabled) {
    background: #0056b3;
  }
  
  .imagekit-upload-btn:disabled {
    background: #6c757d;
    cursor: not-allowed;
  }
  
  .imagekit-progress {
    margin-top: 10px;
    background: #f8f9fa;
    border-radius: 4px;
    padding: 5px;
    min-height: 20px;
  }
  
  .imagekit-progress-bar {
    height: 10px;
    background: #28a745;
    border-radius: 2px;
    transition: width 0.3s ease;
    width: 0%;
  }
  
  .imagekit-progress-text {
    font-size: 12px;
    color: #6c757d;
    margin-left: 5px;
  }
`;
document.head.appendChild(style);
