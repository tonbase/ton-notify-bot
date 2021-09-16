const AddressRepository = require('../repositories/address')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  return addressRepository.restoreOne(addressId)
}
