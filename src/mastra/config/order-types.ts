import type { OrderTypeConfig } from '../schemas/extraction-config';

// Shared ZORN sales order fields (used by both standard and Italy variants)
const zornSalesOrderFields: OrderTypeConfig['fields'] = [
  {
    key: 'poNumber',
    label: 'PO Number',
    type: 'string',
    required: true,
    description: 'Customer purchase order number. Fallback: use email subject line or email received date if missing.',
  },
  {
    key: 'poDate',
    label: 'PO Date',
    type: 'date',
    required: true,
    description: 'Date the PO was issued by the customer (ISO 8601). Fallback: use email received date.',
  },
  {
    key: 'requestedDeliveryDate',
    label: 'Requested Delivery Date',
    type: 'date',
    required: false,
    description: 'When the customer wants delivery (ISO 8601). Will be adjusted to valid shipment slot downstream.',
  },
  {
    key: 'lineItems',
    label: 'Line Items',
    type: 'array',
    required: true,
    description: 'Array of objects with: materialId (Opple article/SKU code), quantity (number), unitPrice (number, optional), unit (string, optional)',
  },
  {
    key: 'deliveryAddress',
    label: 'Delivery Address',
    type: 'address',
    required: false,
    description: 'Ship-to address if different from standard SAP ship-to. Include contact person and phone for direct delivery.',
  },
  {
    key: 'quoteReference',
    label: 'Quote Reference',
    type: 'string',
    required: false,
    description: 'Quotation number if the customer references a specific quotation.',
  },
  {
    key: 'deliveryNote',
    label: 'Delivery Note / Customer Remarks',
    type: 'string',
    required: false,
    description: 'Any special delivery instructions, customer remarks, or notes to copy into SAP text fields.',
  },
  {
    key: 'contactPerson',
    label: 'Contact Person',
    type: 'string',
    required: false,
    description: 'Contact name at the delivery address (required for direct/dummy ship-to deliveries).',
  },
  {
    key: 'contactPhone',
    label: 'Contact Phone',
    type: 'string',
    required: false,
    description: 'Phone number at the delivery address (required for direct/dummy ship-to deliveries).',
  },
];

export const orderTypeConfigs: OrderTypeConfig[] = [
  {
    orderType: 'sales_order_zorn',
    label: 'Sales Order (ZORN)',
    description: 'Standard customer sales order — creates SAP transaction ZORN. Price compared against SAP system price.',
    fields: zornSalesOrderFields,
  },
  {
    orderType: 'sales_order_zorn_italy',
    label: 'Sales Order (ZORN Italy)',
    description: 'Italian customer sales order — creates SAP transaction ZORN with special pricing. Customer price always used; SAP holds only minimum floor, no real price list.',
    fields: zornSalesOrderFields,
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
