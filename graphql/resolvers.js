const resolvers = {
  Query: {
    getUser: async (_, { id }, { dataSources }) => dataSources.userAPI.getUserById(id),
    getUsers: async (_, { limit, offset }, { dataSources }) => 
      dataSources.userAPI.getUsers({ limit, offset }),
    getProduct: async (_, { id }, { dataSources }) => dataSources.productAPI.getProductById(id),
    getProducts: async (_, { limit, offset }, { dataSources }) => 
      dataSources.productAPI.getProducts({ limit, offset }),
    getOrder: async (_, { id }, { dataSources }) => dataSources.orderAPI.getOrderById(id),
    getOrders: async (_, { limit, offset }, { dataSources }) => 
      dataSources.orderAPI.getOrders({ limit, offset }),
    getCurrentUser: async (_, __, { user }) => user
  },
  Mutation: {
    createOrder: async (_, { input }, { dataSources, user }) => {
      if (!user) throw new Error('Authentication required');
      return dataSources.orderAPI.createOrder({ ...input, userId: user.id });
    },
    updateOrderStatus: async (_, { id, status }, { dataSources, user }) => {
      if (!user || user.role !== 'admin') throw new Error('Admin access required');
      return dataSources.orderAPI.updateOrderStatus(id, status);
    }
  },
  Order: {
    total: async (order, _, { dataSources }) => {
      const product = await dataSources.productAPI.getProductById(order.product);
      return product.price * order.quantity;
    }
  }
};

module.exports = resolvers;