'use client';

import React, { useEffect, useState } from 'react';
import { PDFDownloadLink, Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';
import { type Bill } from '@/lib/firestore';
import { buildUpiPaymentLink } from '@/lib/upi';
import { generateQrDataUrl } from '@/lib/qr';
import logoImage from '@/public/logo.png';

// Extract the src URL from the imported image for React-PDF
const logo = typeof logoImage === 'string' ? logoImage : (logoImage as any).src || logoImage;

// Helvetica (the default base-14 PDF font) has no glyph for ₹ or the proper
// minus sign — they rendered as garbled characters. Poppins covers both, so
// register it instead of relying on the built-in fonts.
Font.register({
  family: 'Poppins',
  fonts: [
    { src: '/fonts/Poppins-Regular.ttf' },
    { src: '/fonts/Poppins-Italic.ttf', fontStyle: 'italic' },
    { src: '/fonts/Poppins-Medium.ttf', fontWeight: 500 },
    { src: '/fonts/Poppins-Bold.ttf', fontWeight: 'bold' },
  ],
});

interface BillPDFProps {
  bill: Bill;
}

// Logo is 238×342px — keep that aspect ratio so it never looks stretched.
// The logo already contains the "DAJAJ" wordmark, so it's sized up to carry
// the branding on its own instead of repeating the name as text below it.
const LOGO_WIDTH = 58;
const LOGO_HEIGHT = Math.round(LOGO_WIDTH * (342 / 238));

const styles = StyleSheet.create({
  page: {
    paddingVertical: 24,
    paddingHorizontal: 18,
    fontSize: 9,
    fontFamily: 'Poppins',
  },
  header: {
    marginBottom: 10,
    alignItems: 'center',
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    fontStyle: 'italic',
    marginBottom: 2,
    color: '#777',
  },
  location: {
    fontSize: 7.5,
    color: '#999',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    borderBottomStyle: 'dashed',
    marginVertical: 8,
  },
  section: {
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    fontSize: 8.5,
  },
  label: {
    color: '#666',
  },
  table: {
    marginBottom: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#999',
  },
  tableHeaderLabel: {
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#666',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 6,
  },
  tableCol1: {
    width: '52%',
  },
  tableCol2: {
    width: '16%',
    textAlign: 'right',
  },
  tableCol3: {
    width: '32%',
    textAlign: 'right',
  },
  itemName: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  itemDetail: {
    fontSize: 7.5,
    color: '#666',
    marginBottom: 1,
  },
  addon: {
    fontSize: 7,
    color: '#888',
    marginLeft: 8,
    marginTop: 1,
  },
  totals: {
    marginTop: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    fontSize: 8.5,
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  qrBlock: {
    alignItems: 'center',
    marginTop: 12,
  },
  qrImage: {
    width: 62,
    height: 62,
  },
  qrLabel: {
    fontSize: 7.5,
    marginTop: 3,
    color: '#666',
  },
  footer: {
    marginTop: 12,
    paddingTop: 8,
    textAlign: 'center',
    fontSize: 8.5,
    color: '#666',
  },
});

const BillDocument = ({ bill, qrDataUrl }: { bill: Bill; qrDataUrl?: string }) => {
  const date = bill.createdAt?.toDate ? bill.createdAt.toDate() : new Date();
  const formattedDate = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const formattedTime = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <Document>
      <Page size={{ width: 300 }} style={styles.page}>
        <View style={styles.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logo} style={styles.logo} />
          <Text style={styles.subtitle}>The Spice of Spices</Text>
          <Text style={styles.location}>Kundapura</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Bill No:</Text>
            <Text>{bill.billNo}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date:</Text>
            <Text>{formattedDate}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Time:</Text>
            <Text>{formattedTime}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Customer:</Text>
            <Text>{bill.customer.name}</Text>
          </View>
          {bill.customer.mobile && (
            <View style={styles.row}>
              <Text style={styles.label}>Mobile:</Text>
              <Text>{bill.customer.mobile}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.tableCol1}><Text style={styles.tableHeaderLabel}>Item</Text></View>
            <View style={styles.tableCol2}><Text style={styles.tableHeaderLabel}>Qty</Text></View>
            <View style={styles.tableCol3}><Text style={styles.tableHeaderLabel}>Price</Text></View>
          </View>
          {bill.items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.tableCol1}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.variant ? <Text style={styles.itemDetail}>{item.variant}</Text> : null}
                {item.addons.map((addon, ai) => (
                  <Text key={ai} style={styles.addon}>
                    + {addon.name} (₹{addon.price})
                  </Text>
                ))}
              </View>
              <View style={styles.tableCol2}>
                <Text>{item.qty}</Text>
              </View>
              <View style={styles.tableCol3}>
                <Text>₹{item.itemTotal.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.label}>Subtotal:</Text>
            <Text style={styles.label}>₹{bill.subtotal.toFixed(2)}</Text>
          </View>
          {bill.deliveryCharge ? (
            <View style={styles.totalRow}>
              <Text style={styles.label}>Delivery Charge:</Text>
              <Text style={styles.label}>+ ₹{bill.deliveryCharge.toFixed(2)}</Text>
            </View>
          ) : null}
          {bill.discount ? (
            <View style={styles.totalRow}>
              <Text style={styles.label}>Discount{bill.discountPercent ? ` (${bill.discountPercent}%)` : ''}:</Text>
              <Text style={styles.label}>− ₹{bill.discount.toFixed(2)}</Text>
            </View>
          ) : null}
          <View style={styles.grandTotal}>
            <Text>Total:</Text>
            <Text>₹{bill.grandTotal.toFixed(2)}</Text>
          </View>
          <View style={[styles.totalRow, { marginTop: 6 }]}>
            <Text style={styles.label}>Payment Mode:</Text>
            <Text style={styles.label}>{bill.paymentMode}</Text>
          </View>
          {bill.cashCollected ? (
            <View style={styles.totalRow}>
              <Text style={styles.label}>Cash Collected:</Text>
              <Text style={styles.label}>₹{bill.cashCollected.toFixed(2)}</Text>
            </View>
          ) : null}
        </View>

        {qrDataUrl ? (
          <View style={styles.qrBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={qrDataUrl} style={styles.qrImage} />
            <Text style={styles.qrLabel}>Scan & Pay ₹{bill.grandTotal.toFixed(2)}</Text>
          </View>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.footer}>
          <Text>Thank you. Visit Again.</Text>
        </View>
      </Page>
    </Document>
  );
};

export default function BillPDF({ bill }: BillPDFProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    generateQrDataUrl(buildUpiPaymentLink(bill.grandTotal, bill.billNo), 200)
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [bill.grandTotal, bill.billNo]);

  return (
    <PDFDownloadLink
      document={<BillDocument bill={bill} qrDataUrl={qrDataUrl} />}
      fileName={`${bill.billNo}.pdf`}
      className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium inline-block"
    >
      {(({ loading }: { loading: boolean }) => (
        <span>{loading ? 'Generating PDF...' : 'Download PDF'}</span>
      )) as any}
    </PDFDownloadLink>
  );
}

