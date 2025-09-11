import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

// Mock data for history (replace with your API call)
const callHistory = [
  { id: 1, partner: 'User B', type: 'video', date: '2023-10-01', duration: '5:30' },
  // Add more...
];

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Call History</Text>
      <FlatList
        data={callHistory}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text>{item.partner} - {item.type} call</Text>
            <Text>{item.date} ({item.duration})</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f0f0f0' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  item: { padding: 10, borderBottomWidth: 1, borderColor: '#ddd' },
});