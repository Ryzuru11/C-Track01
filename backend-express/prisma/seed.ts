import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { syncRbac } from '../src/rbac/sync';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...\n');

  // Clean existing data (in reverse order of dependencies)
  console.log('🧹 Cleaning existing data...');
  await prisma.notification.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.commentDelivered.deleteMany();
  await prisma.commentRead.deleteMany();
  await prisma.reportComment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.report.deleteMany();
  await prisma.location.deleteMany();
  await prisma.takenTask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.modelHasPermission.deleteMany();
  await prisma.modelHasRole.deleteMany();
  await prisma.roleHasPermission.deleteMany();
  await prisma.rbacAuditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  console.log('✓ Cleaned existing data\n');

  // ============================================
  // 1 & 2. PERMISSIONS + ROLES (katalog RBAC v2)
  // ============================================
  console.log('🔐 Syncing RBAC catalog (permissions & system roles)...');
  const rbacSummary = await syncRbac(prisma);
  const findRole = (name: string) =>
    prisma.role.findUniqueOrThrow({ where: { name_guardName: { name, guardName: 'web' } } });
  const superadminRole = await findRole('superadmin');
  const adminRole = await findRole('admin');
  const managerRole = await findRole('manager');
  const employeeRole = await findRole('employee');
  console.log(`✓ Synced ${rbacSummary.permissionsUpserted} permissions and 4 roles (superadmin, admin, manager, employee)\n`);

  // ============================================
  // 3. CREATE USERS
  // ============================================
  console.log('👤 Creating users...');
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Superadmin
  const superadmin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'superadmin@trackingapp.com',
      password: hashedPassword,
      phoneNumber: '+6281234567890',
      department: 'Management',
      position: 'System Administrator',
      address: 'Jl. Malioboro No. 1, Yogyakarta',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.modelHasRole.create({
    data: {
      roleId: superadminRole.id,
      modelType: 'App\\Models\\User',
      modelId: superadmin.id,
    },
  });

  // Create Admin 1
  const admin1 = await prisma.user.create({
    data: {
      name: 'John Doe',
      email: 'admin@trackingapp.com',
      password: hashedPassword,
      phoneNumber: '+6281234567891',
      department: 'Operations',
      position: 'Operations Manager',
      address: 'Jl. Kaliurang KM 5, Sleman, Yogyakarta',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.modelHasRole.create({
    data: {
      roleId: adminRole.id,
      modelType: 'App\\Models\\User',
      modelId: admin1.id,
    },
  });

  // Create Admin 2
  const admin2 = await prisma.user.create({
    data: {
      name: 'Sarah Johnson',
      email: 'sarah.admin@trackingapp.com',
      password: hashedPassword,
      phoneNumber: '+6281234567892',
      department: 'Human Resources',
      position: 'HR Manager',
      address: 'Jl. Sudirman No. 45, Yogyakarta',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.modelHasRole.create({
    data: {
      roleId: adminRole.id,
      modelType: 'App\\Models\\User',
      modelId: admin2.id,
    },
  });

  // Create Manager
  const manager = await prisma.user.create({
    data: {
      name: 'Budi Santoso',
      email: 'manager@trackingapp.com',
      password: hashedPassword,
      phoneNumber: '+6281234567801',
      department: 'Operations',
      position: 'Field Operations Manager',
      address: 'Jl. Affandi No. 10, Gejayan, Sleman, Yogyakarta',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.modelHasRole.create({
    data: {
      roleId: managerRole.id,
      modelType: 'App\\Models\\User',
      modelId: manager.id,
    },
  });

  // Create Employees
  const employeesData = [
    {
      name: 'Michael Smith',
      email: 'michael@trackingapp.com',
      phoneNumber: '+6281234567893',
      department: 'Sales',
      position: 'Sales Representative',
      address: 'Jl. Solo KM 8, Kalasan, Sleman, Yogyakarta',
    },
    {
      name: 'Emily Davis',
      email: 'emily@trackingapp.com',
      phoneNumber: '+6281234567894',
      department: 'Operations',
      position: 'Field Agent',
      address: 'Jl. Magelang KM 7, Mlati, Sleman, Yogyakarta',
    },
    {
      name: 'David Wilson',
      email: 'david@trackingapp.com',
      phoneNumber: '+6281234567895',
      department: 'Logistics',
      position: 'Delivery Driver',
      address: 'Jl. Bantul KM 5, Sewon, Bantul, Yogyakarta',
    },
    {
      name: 'Jennifer Brown',
      email: 'jennifer@trackingapp.com',
      phoneNumber: '+6281234567896',
      department: 'Sales',
      position: 'Account Executive',
      address: 'Jl. Wonosari KM 10, Banguntapan, Bantul, Yogyakarta',
    },
    {
      name: 'Robert Taylor',
      email: 'robert@trackingapp.com',
      phoneNumber: '+6281234567897',
      department: 'Logistics',
      position: 'Warehouse Manager',
      address: 'Jl. Ring Road Utara, Condongcatur, Sleman, Yogyakarta',
    },
    {
      name: 'Lisa Anderson',
      email: 'lisa@trackingapp.com',
      phoneNumber: '+6281234567898',
      department: 'Operations',
      position: 'Field Technician',
      address: 'Jl. Godean KM 5, Gamping, Sleman, Yogyakarta',
    },
    {
      name: 'James Martinez',
      email: 'james@trackingapp.com',
      phoneNumber: '+6281234567899',
      department: 'Sales',
      position: 'Territory Manager',
      address: 'Jl. Imogiri Timur KM 12, Imogiri, Bantul, Yogyakarta',
    },
    {
      name: 'Maria Garcia',
      email: 'maria@trackingapp.com',
      phoneNumber: '+6281234567800',
      department: 'Operations',
      position: 'Site Supervisor',
      address: 'Jl. Wates KM 8, Gamping, Sleman, Yogyakarta',
    },
  ];

  for (const empData of employeesData) {
    const employee = await prisma.user.create({
      data: {
        ...empData,
        password: hashedPassword,
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.modelHasRole.create({
      data: {
        roleId: employeeRole.id,
        modelType: 'App\\Models\\User',
        modelId: employee.id,
      },
    });
  }

  console.log('✓ Created 12 users (1 superadmin, 2 admins, 1 manager, 8 employees)\n');

  // ============================================
  // 4. CREATE TASKS (dengan alamat asli Jogja)
  // ============================================
  console.log('📋 Creating tasks with real Jogja addresses...');

  const tasksData = [
    {
      title: 'Kunjungan Client - Malioboro',
      description: 'Pertemuan dengan client potensial untuk membahas kebutuhan proyek baru. Bawa materi presentasi dan dokumen kontrak.',
      location: 'Jl. Malioboro No. 52-58, Sosromenduran, Gedong Tengen, Kota Yogyakarta, DIY 55271',
      latitude: -7.7933988,
      longitude: 110.3659315,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Instalasi Peralatan - UGM',
      description: 'Instalasi dan konfigurasi peralatan tracking baru di kampus UGM. Test semua fungsi sebelum meninggalkan lokasi.',
      location: 'Universitas Gadjah Mada, Bulaksumur, Caturtunggal, Kec. Depok, Kabupaten Sleman, DIY 55281',
      latitude: -7.7719498,
      longitude: 110.3774731,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Inspeksi Lokasi - Gudang Adisucipto',
      description: 'Lakukan inspeksi keamanan bulanan di Gudang Adisucipto. Lengkapi checklist dan dokumentasikan temuan.',
      location: 'Jl. Raya Solo - Yogyakarta KM 10, Kalasan, Sleman, DIY 55571',
      latitude: -7.7877565,
      longitude: 110.4388642,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Pengiriman Paket - Alun-Alun Kidul',
      description: 'Antar paket ke lokasi customer dan dapatkan tanda tangan. Pastikan produk dalam kondisi baik saat tiba.',
      location: 'Alun-Alun Kidul, Jl. Alun Alun Kidul, Patehan, Kraton, Kota Yogyakarta, DIY 55133',
      latitude: -7.8127756,
      longitude: 110.3644595,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Maintenance Check - Ambarrukmo Plaza',
      description: 'Lakukan pengecekan maintenance triwulanan pada semua peralatan di Ambarrukmo Plaza.',
      location: 'Ambarrukmo Plaza, Jl. Laksamana Adisucipto No.21-23, Caturtunggal, Kec. Depok, Kabupaten Sleman, DIY 55281',
      latitude: -7.7827886,
      longitude: 110.4025074,
      status: 'inactive',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Sesi Training - Jogja City Mall',
      description: 'Lakukan sesi training untuk karyawan baru tentang prosedur perusahaan dan protokol keamanan.',
      location: 'Jogja City Mall, Jl. Magelang No.KM. 6, Kutu Patran, Sinduadi, Kec. Mlati, Kabupaten Sleman, DIY 55284',
      latitude: -7.7525813,
      longitude: 110.3696584,
      status: 'inactive',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Pengumpulan Data - Prambanan',
      description: 'Kunjungi lokasi yang ditentukan untuk mengumpulkan data bulanan dan kirim laporan sebelum akhir hari.',
      location: 'Candi Prambanan, Jl. Raya Solo - Yogyakarta No.16, Kranggan, Bokoharjo, Prambanan, Sleman, DIY 55571',
      latitude: -7.7520029,
      longitude: 110.4914855,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Setup Jaringan - Hartono Mall',
      description: 'Setup infrastruktur jaringan baru di Hartono Mall. Konfigurasi router, switch, dan access point.',
      location: 'Hartono Mall Yogyakarta, Jl. Ring Road Utara, Maguwoharjo, Depok, Sleman, DIY 55282',
      latitude: -7.7530751,
      longitude: 110.4161726,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Audit Kualitas - Saphir Square',
      description: 'Lakukan audit kualitas di Saphir Square. Dokumentasikan temuan dan rekomendasikan perbaikan.',
      location: 'Saphir Square, Jl. Laksda Adisucipto No.32-34, Demangan, Gondokusuman, Kota Yogyakarta, DIY 55221',
      latitude: -7.7823498,
      longitude: 110.3905702,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Respon Emergency - Kridosono Stadium',
      description: 'Tanggapi situasi darurat di Stadion Kridosono. Nilai kerusakan dan koordinasikan upaya perbaikan.',
      location: 'Stadion Kridosono, Jl. Kusumanegara, Muja Muju, Umbulharjo, Kota Yogyakarta, DIY 55165',
      latitude: -7.7991389,
      longitude: 110.3988889,
      status: 'inactive',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Inventory Count - Terminal Giwangan',
      description: 'Lakukan penghitungan inventory bulanan di Terminal Giwangan. Update sistem dengan jumlah yang akurat.',
      location: 'Terminal Giwangan, Jl. Imogiri Tim., Giwangan, Umbulharjo, Kota Yogyakarta, DIY 55163',
      latitude: -7.8311651,
      longitude: 110.3922813,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Customer Support - Tugu Yogyakarta',
      description: 'Kunjungi lokasi customer untuk troubleshoot masalah yang dilaporkan dan berikan dukungan on-site.',
      location: 'Tugu Yogyakarta, Jl. Jenderal Sudirman, Bausasran, Kec. Danurejan, Kota Yogyakarta, DIY 55211',
      latitude: -7.7828735,
      longitude: 110.3671765,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Review Dokumentasi - Keraton Yogyakarta',
      description: 'Review dan update dokumentasi proyek di area Keraton. Pastikan semua record terkini.',
      location: 'Keraton Ngayogyakarta Hadiningrat, Jl. Rotowijayan Blok No. 1, Panembahan, Kraton, Kota Yogyakarta, DIY 55131',
      latitude: -7.8052892,
      longitude: 110.3643742,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Pengambilan Peralatan - Lippo Plaza',
      description: 'Ambil peralatan baru dari vendor di Lippo Plaza dan transport ke gudang. Verifikasi kelengkapan pesanan.',
      location: 'Lippo Plaza Jogja, Jl. Laksda Adisucipto No.32-34, Demangan, Gondokusuman, Kota Yogyakarta, DIY 55221',
      latitude: -7.7822974,
      longitude: 110.3906636,
      status: 'inactive',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Safety Training - Pasar Beringharjo',
      description: 'Berikan training keselamatan wajib kepada petugas lapangan di area Pasar Beringharjo.',
      location: 'Pasar Beringharjo, Jl. Pabringan No.1, Ngupasan, Gondomanan, Kota Yogyakarta, DIY 55122',
      latitude: -7.7982532,
      longitude: 110.3653583,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Field Visit - Mergangsan',
      description: 'Kunjungan lapangan ke lokasi Brontokusuman, Kecamatan Mergangsan. Lakukan pengecekan dan dokumentasi kondisi lokasi.',
      location: 'Jl. Gerilya No.629, Brontokusuman, Kec. Mergangsan, Kota Yogyakarta, DIY 55153',
      latitude: -7.8215,
      longitude: 110.3717,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Inspeksi Ruttin - Stasiun Tugu',
      description: 'Lakukan inspeksi rutin bulanan di area Stasiun Tugu Yogyakarta. Dokumentasikan setiap temuan.',
      location: 'Stasiun Tugu Yogyakarta, Jl. Margo Utomo No.1, Bausasran, Kec. Danurejan, Kota Yogyakarta, DIY 55211',
      latitude: -7.7894722,
      longitude: 110.3638889,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Survey Lokasi - Parangtritis Beach',
      description: 'Survey lokasi pantai untuk proyek baru. Ambil foto and ukuran yang diperlukan.',
      location: 'Pantai Parangtritis, Jl. Parangtritis, Mancingan, Parangtritis, Kretek, Bantul, DIY 55772',
      latitude: -8.0247453,
      longitude: 110.3287531,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Instalasi Sistem - Plaza Ambarrukmo',
      description: 'Instalasi sistem keamanan baru di Plaza Ambarrukmo. Test semua sensor dan kamera.',
      location: 'Plaza Ambarrukmo, Jl. Laksda Adisucipto No.Kav. 101, Caturtunggal, Sleman, DIY 55281',
      latitude: -7.7823456,
      longitude: 110.4013678,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
    {
      title: 'Pelatihan Staf - Perpustakaan Grhatama Pustaka',
      description: 'Lakukan pelatihan untuk staf perpustakaan tentang sistem tracking buku baru.',
      location: 'Perpustakaan Grhatama Pustaka, Jl. Jend. Sudirman No.99, Suryatmajan, Danurejan, Kota Yogyakarta, DIY 55213',
      latitude: -7.7886452,
      longitude: 110.3710234,
      status: 'active',
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T17:00:00'),
      manualOverride: true,
    },
  ];

  for (const taskData of tasksData) {
    await prisma.task.create({
      data: taskData,
    });
  }

  console.log(`✓ Created ${tasksData.length} tasks with real Jogja addresses\n`);

  // ============================================
  // 5. CREATE TAKEN TASKS (ASSIGNMENTS)
  // ============================================
  console.log('📌 Creating task assignments (taken tasks)...');

  // Get all tasks and employees
  const allTasks = await prisma.task.findMany();
  const employees = await prisma.user.findMany({
    where: {
      modelHasRoles: {
        some: {
          role: {
            name: 'employee',
          },
        },
      },
    },
  });

  const takenTasksData = [];
  
  // Pre-defined statuses for the first 10 assignments
  const preDefinedStatuses = [
    'pending',      // TSK 1
    'pending',      // TSK 2
    'pending',      // TSK 3
    'pending',      // TSK 4
    'completed',    // TSK 5
    'completed',    // TSK 6
    'pending',      // TSK 7
    'in_progress',  // TSK 8
    'pending',      // TSK 9
    'completed'     // TSK 10
  ];

  // Assign first 10 tasks to different employees
  for (let i = 0; i < Math.min(10, allTasks.length); i++) {
    const task = allTasks[i];
    const assignedEmployee = employees[i % employees.length];
    
    // Determine status based on predefined list
    const takenTaskStatus = preDefinedStatuses[i] || 'pending';

    const takenTask = await prisma.takenTask.create({
      data: {
        ticketNumber: `TK-${Date.now()}-${i + 1}`,
        taskId: task.taskId,
        userIds: JSON.stringify([assignedEmployee.id]),
        userStatuses: JSON.stringify({
          [assignedEmployee.id]: takenTaskStatus,
        }),
        startTime: takenTaskStatus === 'in_progress' || takenTaskStatus === 'completed' 
          ? new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 hours ago
          : null,
        endTime: takenTaskStatus === 'completed'
          ? new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
          : null,
        date: new Date(),
        status: takenTaskStatus,
      },
    });

    takenTasksData.push({
      takenTask,
      task,
      employee: assignedEmployee,
    });
  }

  console.log(`✓ Created ${takenTasksData.length} task assignments\n`);

  // ============================================
  // 6. CREATE LOCATION TRACKING DATA
  // ============================================
  console.log('📍 Creating location tracking data...');

  let locationCount = 0;

  for (const { takenTask, task, employee } of takenTasksData) {
    // Only create locations for in_progress and completed tasks
    if (takenTask.status === 'in_progress' || takenTask.status === 'completed') {
      const numLocations = takenTask.status === 'completed' ? 8 : 5;
      
      for (let i = 0; i < numLocations; i++) {
        const recordedAt = new Date(
          Date.now() - (numLocations - i) * 30 * 60 * 1000
        ); // Every 30 minutes

        // Add slight random offset to location
        const latOffset = (Math.random() - 0.5) * 0.001;
        const lngOffset = (Math.random() - 0.5) * 0.001;

        await prisma.location.create({
          data: {
            takenTaskId: takenTask.takenTaskId,
            userId: employee.id,
            latitude: Number(task.latitude) + latOffset,
            longitude: Number(task.longitude) + lngOffset,
            accuracy: Math.floor(Math.random() * 20) + 5, // 5-25 meters
            address: task.location,
            trackingStatus: i === 0 || i === numLocations - 1 ? 'manual' : 'auto',
            recordedAt,
          },
        });

        locationCount++;
      }
    }
  }

  console.log(`✓ Created ${locationCount} location tracking records\n`);

  // ============================================
  // 7. CREATE REPORTS
  // ============================================
  console.log('📄 Creating task reports...');

  const reportTexts = [
    'Tugas telah diselesaikan sesuai dengan jadwal. Semua peralatan berfungsi dengan baik dan customer sangat puas dengan hasilnya.',
    'Kunjungan berjalan lancar. Berhasil bertemu dengan pihak client dan membahas semua poin yang ada dalam agenda. Follow-up meeting dijadwalkan minggu depan.',
    'Instalasi selesai 100%. Semua komponen telah ditest dan berfungsi normal. Sudah memberikan brief training ke tim customer.',
    'Inspeksi lengkap dilakukan. Ditemukan beberapa minor issues yang sudah dicatat dalam checklist. Rekomendasi perbaikan sudah dikirim via email.',
    'Pengiriman sukses. Paket diterima dalam kondisi baik dan sudah ditandatangani oleh penerima. Dokumentasi lengkap tersimpan.',
    'Maintenance check selesai dilakukan. Semua equipment dalam kondisi baik, tidak ada maintenance critical yang perlu immediate action.',
    'Sesi training berjalan dengan baik. Peserta aktif dan responsif. Assessment test menunjukkan tingkat pemahaman yang baik.',
    'Data collection selesai. Semua data yang diperlukan sudah terkumpul dan divalidasi. Laporan detail akan di-submit akhir hari ini.',
  ];

  let reportCount = 0;

  for (const { takenTask, task, employee } of takenTasksData) {
    // Create reports for completed tasks
    if (takenTask.status === 'completed') {
      await prisma.report.create({
        data: {
          ticketNumber: `RPT-${Date.now()}-${reportCount + 1}`,
          userId: employee.id,
          takenTaskId: takenTask.takenTaskId,
          report: reportTexts[reportCount % reportTexts.length],
          image: null, // You can add sample image paths if needed
        },
      });

      reportCount++;
    }
  }

  console.log(`✓ Created ${reportCount} task reports\n`);

  // ============================================
  // 8. ADDITIONAL ASSIGNMENTS (Multi-user tasks)
  // ============================================
  console.log('👥 Creating multi-user task assignments...');

  // Assign some tasks to multiple employees
  const multiUserTasks = allTasks.slice(10, 13); // Take 3 tasks
  let multiAssignCount = 0;

  for (const task of multiUserTasks) {
    // Assign to 2-3 employees
    const numEmployees = Math.floor(Math.random() * 2) + 2; // 2 or 3
    const assignedEmployees = employees.slice(0, numEmployees);
    
    const userIds = assignedEmployees.map(emp => emp.id);
    const userStatuses: Record<string, string> = {};
    assignedEmployees.forEach(emp => {
      userStatuses[emp.id] = 'pending';
    });

    await prisma.takenTask.create({
      data: {
        ticketNumber: `TK-MULTI-${Date.now()}-${multiAssignCount + 1}`,
        taskId: task.taskId,
        userIds: JSON.stringify(userIds),
        userStatuses: JSON.stringify(userStatuses),
        startTime: null,
        endTime: null,
        date: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        status: 'pending',
      },
    });

    multiAssignCount++;
  }

  console.log(`✓ Created ${multiAssignCount} multi-user task assignments\n`);

  // ============================================
  // SUMMARY
  // ============================================
  console.log('════════════════════════════════════════');
  console.log('✅ Database seeding completed successfully!');
  console.log('════════════════════════════════════════');
  console.log('\n📊 Summary:');
  console.log(`  - Permissions: ${rbacSummary.permissionsUpserted}`);
  console.log('  - Roles: 4 (superadmin, admin, manager, employee)');
  console.log('  - Users: 12 (1 superadmin, 2 admins, 1 manager, 8 employees)');
  console.log(`  - Tasks: ${allTasks.length} (with real Jogja addresses)`);
  console.log(`  - Assignments: ${takenTasksData.length + multiAssignCount} (single + multi-user)`);
  console.log(`  - Location Records: ${locationCount}`);
  console.log(`  - Reports: ${reportCount}`);
  console.log('\n🔐 Login credentials:');
  console.log('  Superadmin: superadmin@trackingapp.com / password123');
  console.log('  Admin: admin@trackingapp.com / password123');
  console.log('  Manager: manager@trackingapp.com / password123');
  console.log('  Employee: michael@trackingapp.com / password123');
  console.log('  Employee: emily@trackingapp.com / password123');
  console.log('  Employee: david@trackingapp.com / password123');
  console.log('\n💡 All users have the same password: password123');
  console.log('\n📱 Database includes:');
  console.log('  ✓ Complete user management with roles & permissions');
  console.log('  ✓ 20 tasks with real Yogyakarta addresses');
  console.log('  ✓ Task assignments (single & multi-user)');
  console.log('  ✓ Location tracking data for active tasks');
  console.log('  ✓ Task completion reports');
  console.log('════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
