# 1. เลือก "กล่อง" Node.js เวอร์ชัน 18
FROM node:18-slim

# 2. ตั้งค่าพื้นที่ทำงาน
WORKDIR /usr/src/app

# 3. คัดลอกไฟล์ package.json และ package-lock.json
COPY package*.json ./

# 4. ติดตั้ง dependencies
RUN npm install

# 5. คัดลอกโค้ดเซิร์ฟเวอร์
COPY . .

# 6. บอกว่าเซิร์ฟเวอร์จะรับ "PORT" จากข้างนอก
# และใช้ 8080 เป็นค่าเริ่มต้น
EXPOSE 8080

# 7. คำสั่งในการ "เริ่ม" เซิร์ฟเวอร์
CMD [ "node", "server.js" ]