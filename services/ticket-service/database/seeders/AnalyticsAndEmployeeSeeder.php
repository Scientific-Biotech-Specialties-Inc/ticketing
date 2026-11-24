<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AnalyticsAndEmployeeSeeder extends Seeder
{
    public function run(): void
    {
        // Seed 52 Employees in employees table. The analytics_* demo rows this seeder used to
        // write were removed with those tables (database cleanup, phase 3).
        $employeesData = [
            ['emp_id' => 1, 'first_name' => 'Ava', 'last_name' => 'Santos', 'email' => 'cs@gmail.com', 'role' => 'customer service', 'department' => 'Customer Support'],
            ['emp_id' => 2, 'first_name' => 'Mark', 'last_name' => 'Reyes', 'email' => 'employee@gmail.com', 'role' => 'service engineer', 'department' => 'Service'],
            ['emp_id' => 3, 'first_name' => 'John', 'last_name' => 'Dela Cruz', 'email' => 'tech1@example.com', 'role' => 'service engineer', 'department' => 'IT Support'],
            ['emp_id' => 4, 'first_name' => 'Bernadette', 'last_name' => 'Gonzaga', 'email' => 'slosinada@gmail.com', 'role' => 'service engineer', 'department' => 'Service'],
            ['emp_id' => 1004, 'first_name' => 'Sarah', 'last_name' => 'Jenkins', 'email' => 's.jenkins@hospital.com', 'role' => 'Technician', 'department' => 'Biomedical Engineering'],
            ['emp_id' => 1012, 'first_name' => 'Marcus', 'last_name' => 'Vance', 'email' => 'm.vance@hospital.com', 'role' => 'Specialist', 'department' => 'IT Support'],
            ['emp_id' => 1008, 'first_name' => 'Elena', 'last_name' => 'Rostova', 'email' => 'e.rostova@hospital.com', 'role' => 'Engineer', 'department' => 'Radiology Maintenance'],
            ['emp_id' => 1019, 'first_name' => 'David', 'last_name' => 'Chen', 'email' => 'd.chen@hospital.com', 'role' => 'Analyst', 'department' => 'Network Operations'],
            ['emp_id' => 1025, 'first_name' => 'Amira', 'last_name' => 'Hassan', 'email' => 'a.hassan@hospital.com', 'role' => 'Technician', 'department' => 'Facilities & Equipment'],
        ];

        // Generate additional 43 employees to reach 52 total employee records
        $names = [
            ['Alexander', 'Wright', 'IT Support', 'Specialist'],
            ['Beatrice', 'Kim', 'Biomedical Engineering', 'Technician'],
            ['Carlos', 'Mendoza', 'Service', 'Senior Engineer'],
            ['Diana', 'Prince', 'Radiology Maintenance', 'Engineer'],
            ['Ethan', 'Hunt', 'Network Operations', 'Analyst'],
            ['Fiona', 'Gallagher', 'Customer Support', 'Support Specialist'],
            ['Gabriel', 'Silva', 'Facilities & Equipment', 'Technician'],
            ['Hannah', 'Abbott', 'IT Support', 'Specialist'],
            ['Ian', 'Malcolm', 'Biomedical Engineering', 'Engineer'],
            ['Julia', 'Roberts', 'Service', 'Engineer'],
            ['Kevin', 'Bacon', 'Customer Support', 'Specialist'],
            ['Laura', 'Croft', 'Network Operations', 'Analyst'],
            ['Michael', 'Scott', 'IT Support', 'Lead Specialist'],
            ['Nina', 'Dobrev', 'Radiology Maintenance', 'Technician'],
            ['Oliver', 'Queen', 'Service', 'Senior Engineer'],
            ['Penelope', 'Cruz', 'Biomedical Engineering', 'Analyst'],
            ['Quentin', 'Tarantino', 'Facilities & Equipment', 'Technician'],
            ['Rachel', 'Green', 'Customer Support', 'Support Specialist'],
            ['Steven', 'Strange', 'Radiology Maintenance', 'Lead Engineer'],
            ['Tina', 'Fey', 'IT Support', 'Specialist'],
            ['Ulysses', 'Grant', 'Network Operations', 'Engineer'],
            ['Victor', 'Stone', 'Biomedical Engineering', 'Technician'],
            ['Wanda', 'Maximoff', 'Service', 'Senior Engineer'],
            ['Xavier', 'Charles', 'IT Support', 'Lead Analyst'],
            ['Yara', 'Shahidi', 'Customer Support', 'Support Representative'],
            ['Zachary', 'Levi', 'Facilities & Equipment', 'Technician'],
            ['Arthur', 'Pendelton', 'Service', 'Engineer'],
            ['Bianca', 'Belair', 'Biomedical Engineering', 'Technician'],
            ['Christopher', 'Nolan', 'Network Operations', 'Analyst'],
            ['Daphne', 'Bridgerton', 'Customer Support', 'Support Specialist'],
            ['Edward', 'Elric', 'IT Support', 'Technician'],
            ['Freya', 'Allan', 'Radiology Maintenance', 'Engineer'],
            ['George', 'Russell', 'Service', 'Engineer'],
            ['Heidi', 'Klum', 'Biomedical Engineering', 'Technician'],
            ['Isaaq', 'Newton', 'Network Operations', 'Analyst'],
            ['Jasmine', 'Tookes', 'Customer Support', 'Support Specialist'],
            ['Karl', 'Urban', 'Facilities & Equipment', 'Engineer'],
            ['Lily', 'Collins', 'IT Support', 'Specialist'],
            ['Mason', 'Mount', 'Service', 'Senior Engineer'],
            ['Nora', 'Jones', 'Radiology Maintenance', 'Technician'],
            ['Oscar', 'Isaac', 'Biomedical Engineering', 'Engineer'],
            ['Paige', 'VanZant', 'Customer Support', 'Specialist'],
            ['Quinn', 'Fabray', 'Network Operations', 'Analyst'],
        ];

        $startId = 1026;
        foreach ($names as $idx => $n) {
            $empId = $startId + $idx;
            $employeesData[] = [
                'emp_id' => $empId,
                'first_name' => $n[0],
                'last_name' => $n[1],
                'email' => strtolower($n[0] . '.' . $n[1] . '@hospital.com'),
                'role' => $n[3],
                'department' => $n[2],
            ];
        }

        $passwordHash = Hash::make('12345678');
        foreach ($employeesData as $emp) {
            DB::table('employees')->upsert([
                [
                    'emp_id' => $emp['emp_id'],
                    'first_name' => $emp['first_name'],
                    'last_name' => $emp['last_name'],
                    'email' => $emp['email'],
                    'role' => strtolower($emp['role']),
                    'department' => $emp['department'],
                    'is_active' => true,
                    'password_hash' => $passwordHash,
                ]
            ], ['emp_id'], ['first_name', 'last_name', 'email', 'role', 'department', 'is_active', 'password_hash']);
        }
    }
}
