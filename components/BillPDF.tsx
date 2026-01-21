'use client';

import React from 'react';
import { PDFDownloadLink, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { type Bill } from '@/lib/firestore';
import logoImage from '@/public/logo.png';

// Extract the src URL from the imported image for React-PDF
const logo = typeof logoImage === 'string' ? logoImage : (logoImage as any).src || logoImage;

interface BillPDFProps {
  bill: Bill;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 3,
    color: '#666',
  },
  location: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  section: {
    marginBottom: 15,
    borderTop: '1pt solid #ddd',
    borderBottom: '1pt solid #ddd',
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    fontSize: 9,
  },
  label: {
    color: '#666',
  },
  table: {
    marginBottom: 15,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #eee',
    paddingVertical: 8,
  },
  tableCol1: {
    width: '50%',
  },
  tableCol2: {
    width: '20%',
    textAlign: 'right',
  },
  tableCol3: {
    width: '30%',
    textAlign: 'right',
  },
  itemName: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  itemDetail: {
    fontSize: 8,
    color: '#666',
    marginBottom: 1,
  },
  addon: {
    fontSize: 8,
    color: '#888',
    marginLeft: 10,
    marginTop: 2,
  },
  totals: {
    marginTop: 15,
    borderTop: '1pt solid #ddd',
    paddingTop: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    fontSize: 10,
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1pt solid #ddd',
    fontSize: 14,
    fontWeight: 'bold',
  },
  footer: {
    marginTop: 20,
    paddingTop: 15,
    borderTop: '1pt solid #ddd',
    textAlign: 'center',
    fontSize: 10,
    color: '#666',
  },
  watermark: {
    position: 'absolute',
    top: 250,
    left: 100,
    width: 400,
    height: 400,
    opacity: 0.06,
  }  
});

const BillDocument = ({ bill }: { bill: Bill }) => {
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
      <Page size="A4" style={styles.page}>
        {/* Background Watermark */}
        <Image
          src={logo}
          style={styles.watermark}
        />
        
        {/* Content */}
        <View>
          <View style={styles.header}>
          <Text style={styles.title}>DAJAJ</Text>
          <Text style={styles.subtitle}>Real Grill Taste</Text>
          <Text style={styles.location}>Kundapura</Text>
        </View>

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

        <View style={styles.table}>
          {bill.items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.tableCol1}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemDetail}>{item.variant}</Text>
                <Text style={styles.itemDetail}>{item.sku}</Text>
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
            <Text>Subtotal:</Text>
            <Text>₹{bill.subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.label}>CGST (2.5%):</Text>
            <Text style={styles.label}>₹{bill.cgst.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.label}>SGST (2.5%):</Text>
            <Text style={styles.label}>₹{bill.sgst.toFixed(2)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>Grand Total:</Text>
            <Text>₹{bill.grandTotal.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.label}>Payment Mode:</Text>
            <Text style={styles.label}>{bill.paymentMode}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>Thank you. Visit Again.</Text>
        </View>
        </View>
      </Page>
    </Document>
  );
};

export default function BillPDF({ bill }: BillPDFProps) {
  return (
    <PDFDownloadLink
      document={<BillDocument bill={bill} />}
      fileName={`${bill.billNo}.pdf`}
      className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium inline-block"
    >
      {(({ loading }: { loading: boolean }) => (
        <span>{loading ? 'Generating PDF...' : 'Download PDF'}</span>
      )) as any}
    </PDFDownloadLink>
  );
}

