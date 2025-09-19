// utils/apiResponse.js
// Small helper for consistent API responses

class ApiResponse {
  constructor(statusCode = 400, success = false, message = '', data = null) {
    this.statusCode = statusCode;
    this.success = success;
    this.message = message;
    this.data = data;
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
    };
  }

  send(res) {
    return res.status(this.statusCode).json(this.toJSON());
  }

  // Convenience static helpers
  static ok(res, data = null, message = 'OK', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  static created(res, data = null, message = 'Created') {
    return this.ok(res, data, message, 201);
  }

  static error(res, message = 'Internal Server Error', statusCode = 500, data = null) {
    return res.status(statusCode).json({
      success: false,
      message,
      data
    });
  }

  static badRequest(res, message = 'Bad Request', data = null) {
    return this.error(res, message, 400, data);
  }

  static unauthorized(res, message = 'Unauthorized', data = null) {
    return this.error(res, message, 401, data);
  }

  static notFound(res, message = 'Not Found', data = null) {
    return this.error(res, message, 404, data);
  }
}

module.exports = ApiResponse;
