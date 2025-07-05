const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type User {
    id: ID!
    name: String!
    email: String!
    role: String!
    createdAt: String!
    updatedAt: String!
  }

  type Product {
    id: ID!
    name: String!
    price: Float!
    description: String
    stock: Int!
    createdAt: String!
    updatedAt: String!
  }

  type Order {
    id: ID!
    user: User!
    product: Product!
    quantity: Int!
    status: String!
    total: Float!
    createdAt: String!
    updatedAt: String!
  }

  type PaginatedUsers {
    users: [User!]!
    totalCount: Int!
  }

  type PaginatedProducts {
    products: [Product!]!
    totalCount: Int!
  }

  type PaginatedOrders {
    orders: [Order!]!
    totalCount: Int!
  }

  input CreateOrderInput {
    userId: ID!
    productId: ID!
    quantity: Int!
  }

  type Query {
    getUser(id: ID!): User
    getUsers(limit: Int = 10, offset: Int = 0): PaginatedUsers!
    getProduct(id: ID!): Product
    getProducts(limit: Int = 10, offset: Int = 0): PaginatedProducts!
    getOrder(id: ID!): Order
    getOrders(limit: Int = 10, offset: Int = 0): PaginatedOrders!
    getCurrentUser: User
  }

  type Mutation {
    createOrder(input: CreateOrderInput!): Order!
    updateOrderStatus(id: ID!, status: String!): Order!
  }
`;

module.exports = typeDefs;