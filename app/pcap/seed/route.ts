// @ts-nocheck

import pcapParser from 'pcap-parser';
import { decoders } from 'cap';
import postgres from 'postgres';
import path from 'path';

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

async function seedPCAP() {
  // Create table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS packets (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMP,
      src_ip INET,
      dst_ip INET,
      src_port INTEGER,
      dst_port INTEGER,
      protocol VARCHAR(10),
      length INTEGER
    )
  `;

  // const pcapFilePath =
  //   '/Users/jongyoungkim/JayDev/nextjs-tutorial/nextjs-tutorial-4/app/pcap/seed/anonymized-spi.nf5';
  const pcapFilePath = path.join(import.meta.dirname, 'anonymized-spi.nf5');

  const parser = pcapParser.parse(pcapFilePath);

  parser.on('packet', async (packet: any) => {
    const timestamp = new Date(
      packet.header.timestampSeconds * 1000 +
        packet.header.timestampMicroseconds / 1000,
    );

    const data = packet.data;

    try {
      const eth = decoders.Ethernet(data);
      if (eth.ethertype === 2048) {
        // IPv4
        const ip = decoders.IPV4(data, 14); // Ethernet header is 14 bytes
        let protocol = 'IP';
        let srcPort: number | undefined;
        let dstPort: number | undefined;

        if (ip.protocol === 6) {
          // TCP
          const tcp = decoders.TCP(data, 14 + ip.headerLength);
          srcPort = tcp.srcPort;
          dstPort = tcp.dstPort;
          protocol = 'TCP';
        } else if (ip.protocol === 17) {
          // UDP
          const udp = decoders.UDP(data, 14 + ip.headerLength);
          srcPort = udp.srcPort;
          dstPort = udp.dstPort;
          protocol = 'UDP';
        }

        await sql`
          INSERT INTO packets (timestamp, src_ip, dst_ip, src_port, dst_port, protocol, length)
          VALUES (${timestamp}, ${ip.src}, ${ip.dst}, ${srcPort}, ${dstPort}, ${protocol}, ${packet.header.originalLength})
        `;
      }
    } catch (e) {
      // Skip packets that can't be decoded
      console.log('Skipping packets that cannot be decoded:', e);
    }
  });

  parser.on('end', async () => {
    await sql.end();
    console.log('PCAP seeding complete');
  });

  parser.on('error', (err: any) => {
    console.error('Error parsing PCAP:', err);
    sql.end();
  });
}

// seedPCAP();

export async function GET() {
  try {
    const result = await sql.begin((sql) => [seedPCAP()]);

    return Response.json({ message: 'Database seeded successfully' });
  } catch (error) {
    return Response.json({ error }, { status: 500 });
  }
}
