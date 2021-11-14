module.exports = (str) => str.replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ' ')
