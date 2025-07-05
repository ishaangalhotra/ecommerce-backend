module.exports = {
  initializeSentry: () => ({
    captureException: (err) => {
      console.error('Error:', err);
    }
  })
};