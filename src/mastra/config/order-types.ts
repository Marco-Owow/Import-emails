import type { OrderTypeConfig } from '../schemas/extraction-config';

export const orderTypeConfigs: OrderTypeConfig[] = [
  {
    orderType: 'sales_order',
    label: 'Sales Order',
    description: 'A customer order for products/services with quantities and prices',
    fields: [
      {
        key: 'customerName',
        label: 'Customer Name',
        type: 'string',
        required: true,
        description: 'Full name or company name of the customer placing the order',
      },
      {
        key: 'orderDate',
        label: 'Order Date',
        type: 'date',
        required: true,
        description: 'Date the order was placed (ISO 8601 format)',
      },
      {
        key: 'deliveryDate',
        label: 'Requested Delivery Date',
        type: 'date',
        required: false,
        description: 'When the customer wants delivery (ISO 8601 format)',
      },
      {
        key: 'lineItems',
        label: 'Line Items',
        type: 'array',
        required: true,
        description: 'Array of objects with: sku, description, quantity, unitPrice',
      },
      {
        key: 'totalAmount',
        label: 'Total Amount',
        type: 'number',
        required: false,
        description: 'Total order value as a number',
      },
      {
        key: 'shippingAddress',
        label: 'Shipping Address',
        type: 'address',
        required: false,
        description: 'Delivery address with street, city, state/province, postal code, country',
      },
      {
        key: 'poNumber',
        label: 'PO Number',
        type: 'string',
        required: false,
        description: 'Customer purchase order reference number',
      },
    ],
  },
  {
    orderType: 'incoming_shipment',
    label: 'Incoming Shipment',
    description: 'A notification about goods being shipped to us (ASN, tracking, etc.)',
    fields: [
      {
        key: 'supplierName',
        label: 'Supplier Name',
        type: 'string',
        required: true,
        description: 'Name of the supplier or vendor shipping goods',
      },
      {
        key: 'trackingNumber',
        label: 'Tracking Number',
        type: 'string',
        required: false,
        description: 'Shipment tracking or AWB number',
      },
      {
        key: 'expectedArrival',
        label: 'Expected Arrival',
        type: 'date',
        required: false,
        description: 'Expected delivery date (ISO 8601 format)',
      },
      {
        key: 'lineItems',
        label: 'Line Items',
        type: 'array',
        required: true,
        description: 'Array of objects with: sku, description, quantity',
      },
      {
        key: 'referenceNumber',
        label: 'Reference Number',
        type: 'string',
        required: false,
        description: 'Our PO number or supplier reference',
      },
    ],
  },
  {
    orderType: 'service_case',
    label: 'Service Case',
    description: 'A customer complaint, return request, or support inquiry',
    fields: [
      {
        key: 'customerName',
        label: 'Customer Name',
        type: 'string',
        required: true,
        description: 'Customer or company raising the issue',
      },
      {
        key: 'issueDescription',
        label: 'Issue Description',
        type: 'string',
        required: true,
        description: 'Summary of the problem or request',
      },
      {
        key: 'originalOrderRef',
        label: 'Original Order Reference',
        type: 'string',
        required: false,
        description: 'Reference to the original order (PO, order number)',
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'string',
        required: false,
        description: 'Urgency level',
        examples: ['low', 'medium', 'high', 'critical'],
      },
      {
        key: 'requestedAction',
        label: 'Requested Action',
        type: 'string',
        required: false,
        description: 'What the customer wants (replacement, refund, repair, etc.)',
      },
    ],
  },
  {
    orderType: 'no_action',
    label: 'No Action Required',
    description: 'Newsletter, auto-reply, spam, or out-of-scope email',
    fields: [
      {
        key: 'reason',
        label: 'Reason',
        type: 'string',
        required: true,
        description: 'Why this email requires no action (spam, auto-reply, newsletter, etc.)',
      },
    ],
  },
];

export function getOrderTypeConfig(orderType: string): OrderTypeConfig | undefined {
  return orderTypeConfigs.find((c) => c.orderType === orderType);
}
