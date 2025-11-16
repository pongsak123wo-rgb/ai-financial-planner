// Import necessary libraries
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path'); // ❗️ ต้องมี path
const { VertexAI } = require('@google-cloud/vertexai'); 
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000; 

const myCache = new NodeCache({ stdTTL: 600 }); 
app.use(cors()); 

const vertex_ai = new VertexAI({ 
    project: 'finance-ylhb', 
    location: 'us-central1', 
});

app.use(express.json());

// ❗️❗️❗️ [แก้ไข v20] ❗️❗️❗️
// เปลี่ยนจาก '..' (โฟลเดอร์แม่) เป็น __dirname (โฟลเดอร์ปัจจุบัน)
// นี่คือบรรทัดที่แก้ไขตามที่คุณขอครับ
app.use(express.static(__dirname));
// ---------------------------------


// ❗️❗️❗️ [v18] Helper Function: The Tax Calculator ❗️❗️❗️
// (ตรรกะภาษี v18 นี้ถูกต้องแล้ว)
// -------------------------------------------------------------
function calculateTaxOnNetIncome(netIncome) {
    let tax = 0;
    if (netIncome > 5000000) { tax += (netIncome - 5000000) * 0.35; netIncome = 5000000; }
    if (netIncome > 2000000) { tax += (netIncome - 2000000) * 0.30; netIncome = 2000000; }
    if (netIncome > 1000000) { tax += (netIncome - 1000000) * 0.25; netIncome = 1000000; }
    if (netIncome > 750000) { tax += (netIncome - 750000) * 0.20; netIncome = 750000; }
    if (netIncome > 500000) { tax += (netIncome - 500000) * 0.15; netIncome = 500000; }
    if (netIncome > 300000) { tax += (netIncome - 300000) * 0.10; netIncome = 300000; }
    if (netIncome > 150000) { tax += (netIncome - 150000) * 0.05; netIncome = 150000; }
    return tax;
}

function calculateThaiTax(formData) {
    const totalIncome = parseFloat(formData.q_income || 0) * 12;

    const totalExpenses = (parseFloat(formData.q_fixed_expenses || 0) + parseFloat(formData.q_emergency_savings || 0)) * 12;
    const availableSavingsPerYear = Math.max(0, totalIncome - totalExpenses);

    const standardDeduction = Math.min(100000, 0.5 * totalIncome);
    const personalDeduction = 60000;
    
    // [v18] ตรรกะการคำนวณค่าลดหย่อนที่ถูกต้อง
    const insuranceHealthSelf_Capped = Math.min(
        parseFloat(formData.q_insurance_health_self || 0), 
        25000
    );
    const insuranceLife_Raw = parseFloat(formData.q_insurance_life || 0);
    const lifeAndHealthCombined = Math.min(
        insuranceLife_Raw + insuranceHealthSelf_Capped, 
        100000
    );
    const insuranceHealthParents_Capped = Math.min(
        parseFloat(formData.q_insurance_health_parents || 0), 
        15000
    );
    const homeLoanInterest_Capped = Math.min(
        parseFloat(formData.q_home_loan_interest || 0), 
        100000
    );

    const totalDeductionsBeforeTaxPlan = 
        standardDeduction +
        personalDeduction +
        lifeAndHealthCombined + 
        insuranceHealthParents_Capped + 
        homeLoanInterest_Capped; 

    const netIncomeBeforeTaxPlan = Math.max(0, totalIncome - totalDeductionsBeforeTaxPlan);
    const taxPayableBefore = calculateTaxOnNetIncome(netIncomeBeforeTaxPlan);

    const rmfLimit = Math.min(0.3 * totalIncome, 500000);
    const rmfSpace = Math.max(0, rmfLimit - parseFloat(formData.q_rmf_current || 0));
    const ssfLimit = Math.min(0.3 * totalIncome, 200000);
    const ssfSpace = Math.max(0, ssfLimit - parseFloat(formData.q_ssf_current || 0));
    
    return {
        totalIncome,
        availableSavingsPerYear,
        netIncomeBeforeTaxPlan,
        taxPayableBefore,
        deductionSpace: { rmfSpace, ssfSpace }
    };
}
// -------------------------------------------------------------
// [จบส่วน Helper Function]
// -------------------------------------------------------------


// --- [ENDPOINT 1: FINNHUB] ---
// (ไม่เปลี่ยนแปลง)
const API_KEY = process.env.FINNHUB_API_KEY;
app.get('/api/get-price', async (req, res) => {
    let symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
    if (!API_KEY) return res.status(500).json({ error: 'FINNHUB_API_KEY is not configured on server' });
    const cacheKey = `price_${symbol}`;
    if (myCache.has(cacheKey)) { return res.json(myCache.get(cacheKey)); }
    console.log(`[Cache MISS] Fecthing ${symbol} from Finnhub API.`);
    try {
        const internationalTickers = ["GLD", "VOO", "QQQ", "VXUS", "BND", "ARKK", "AAPL", "TSLA", "MSFT", "SHY", "BIL"];
        if (!symbol.includes(':') && !internationalTickers.includes(symbol)) {
             console.warn(`Unrecognized symbol ${symbol}, fetching as is.`);
        }
        const response = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`);
        myCache.set(cacheKey, response.data); 
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch stock data' });
    }
});

// --- [ENDPOINT 2: GEMINI ANALYSIS v19] ---
// (ไม่เปลี่ยนแปลง)
app.post('/api/get-gemini-analysis', async (req, res) => {
    
    try {
        const formData = req.body; 
        const taxCalculations = calculateThaiTax(formData);

        let suggestedStocks = ["VOO", "QQQ", "AAPL", "TSLA", "GLD", "BND"]; 
        try {
            const newsResponse = await axios.get(`https://finnhub.io/api/v1/news?category=general&token=${API_KEY}&minId=10`);
            const relatedTickers = new Set();
            newsResponse.data.slice(0, 30).forEach(news => { if (news.related) { news.related.split(',').forEach(ticker => { if (ticker && ticker.length < 6 && !ticker.includes('.')) relatedTickers.add(ticker); }); } });
            if (relatedTickers.size > 0) { suggestedStocks = Array.from(relatedTickers).slice(0, 15); }
        } catch (e) { console.warn("Finnhub News API failed, using default stocks."); }

        const model = vertex_ai.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: {
                responseMimeType: "application/json" 
            }
        });
        
        // (Prompt v19 - ถูกต้องแล้ว)
        const prompt = `
            คุณคือ AI Financial Planner ผู้เชี่ยวชาญด้าน Goal-Based Investing (ตลาด US) และ การวางแผนภาษี (ไทย)

            ภารกิจ:
            1. วิเคราะห์ข้อมูลลูกค้าและเป้าหมาย (Goals)
            2. สร้าง Persona และ แผนประกัน (อิงจากข้อมูลประกันที่ลูกค้ามี)
            3. สร้าง "แผนลดหย่อนภาษี" (Tax-Saving Plan) โดยใช้ "โจทย์" ที่ฉันคำนวณไว้ให้
            4. วิเคราะห์ความเป็นไปได้ (Feasibility) ของ "แต่ละเป้าหมาย" (Goals) โดยใช้เงินออม "ที่เหลือ"
            5. สร้าง "แผนการลงทุน" (Investment Plan) (US Tickers) สำหรับ "แต่ละเป้าหมาย"

            ---
            [โจทย์] ข้อมูลสถานะการเงินและการคำนวณภาษี (ฉันคำนวณให้แล้ว):
            - รายได้รวมต่อปี: ${taxCalculations.totalIncome}
            - ภาษีที่คาดว่าจะต้องจ่าย (ถ้าไม่ทำอะไรเพิ่ม): ${taxCalculations.taxPayableBefore}
            - เงินออมคงเหลือ (หลังหักค่าใช้จ่าย) ต่อปี: ${taxCalculations.availableSavingsPerYear}
            
            [โจทย์] ช่องว่างการลดหย่อนที่เหลือ (คำนวณเพดานแล้ว):
            - RMF (ซื้อเพิ่มได้อีก): ${taxCalculations.deductionSpace.rmfSpace}
            - SSF (ซื้อเพิ่มได้อีก): ${taxCalculations.deductionSpace.ssfSpace}
            
            [โจทย์] ข้อมูลดิบจากลูกค้า (เผื่อใช้ประกอบ):
            - อายุ: ${formData.q_age} ปี
            - ข้อมูลการลงทุน: ${formData.q_experience}, ${formData.q_knowledge}, ${formData.q_volatility_reaction}, ${formData.q_goal_priority}
            - เป้าหมาย (Goals) ของลูกค้า: ${JSON.stringify(formData.goals)}
            
            [v19] บริบทประกัน:
            - ข้อมูลประกัน (ที่ผู้ใช้กรอกว่ามีแล้ว):
                - ประกันชีวิต: ${formData.q_insurance_life || 0}
                - ประกันสุขภาพ (ตนเอง): ${formData.q_insurance_health_self || 0}
                - ประกันสุขภาพ (พ่อแม่): ${formData.q_insurance_health_parents || 0}
            (ถ้าค่าเหล่านี้เป็น 0, AI ควรสรุปว่าผู้ใช้ยังไม่มี และ "ควรแนะนำ" ใน "insurance_plan")

            - ข้อมูลตลาด (US): ${JSON.stringify(suggestedStocks)}
            ---

            จงวิเคราะห์และตอบกลับเป็น JSON ที่สมบูรณ์แบบ (valid JSON) ตามโครงสร้างนี้:
            {
              "persona": "...",
              "risk_level": "...",
              "risk_name": "...",
              "risk_desc": "...",
              "insurance_plan": [
                { 
                  "name": "ประกันสุขภาพ (เหมาจ่าย)", 
                  "reason": "...", 
                  "estimated_premium_per_year": 25000, 
                  "estimated_coverage": 5000000 
                }
              ],
              "disclaimer": "...",
              "tax_plan": {
                "estimated_net_income": 450000, 
                "estimated_tax_payable_before": ${taxCalculations.taxPayableBefore}, 
                "estimated_tax_payable_after": 10000, 
                "total_tax_saved": 15000, 
                "summary": "...",
                "recommendations": [
                  {
                    "product": "RMF",
                    "amount_to_buy": 100000, 
                    "estimated_tax_saved": 10000, 
                    "reason": "..."
                  }
                ]
              },
              "goal_feasibility": [
                {
                  "goal_name": "...",
                  "probability_of_success_percent": 85,
                  "required_savings_per_month": 5000, 
                  "analysis": "...",
                  "worst_case_scenario": "...",
                  "investment_plan": {
                    "summary": "...",
                    "assets": [ ... ]
                  }
                }
              ]
            }
        `;

        const request = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        };
        const result = await model.generateContent(request);
        
        const response = await result.response;
        const text = response.candidates[0].content.parts[0].text;
        const jsonResponse = JSON.parse(text); 
        
        res.json(jsonResponse); 

    } catch (error) {
        console.error('Error calling Gemini API:', error);
        res.status(500).json({ error: 'Failed to get analysis from Gemini' });
    }
});


// ❗️❗️❗️ [Endpoint 3: "WHAT-IF" SANDBOX] ❗️❗️❗️
// (ไม่เปลี่ยนแปลงจาก v16)
app.post('/api/resimulate-goal', async (req, res) => {
    const { originalGoal, newSavingsPerMonth, clientProfile, investmentPlan } = req.body;
    if (!originalGoal || !clientProfile || !investmentPlan) {
        return res.status(400).json({ error: 'Missing required data for simulation' });
    }
    try {
        const model = vertex_ai.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json" }
        });
        const resimulationPrompt = `
            คุณคือ AI Financial Planner (โหมดจำลองสถานการณ์)
            ภารกิจ: วิเคราะห์ความเป็นไปได้ของ "เป้าหมายเดียว" นี้ใหม่อีกครั้ง โดยใช้ "เงินออมใหม่" ที่ผู้ใช้ป้อนเข้ามา
            ข้อมูลลูกค้า (เพื่อใช้พิจารณา Risk):
            - อายุ: ${clientProfile.q_age}
            - Risk Profile: ${clientProfile.q_experience}, ${clientProfile.q_knowledge}, ${clientProfile.q_volatility_reaction}
            เป้าหมายที่กำลังจำลอง:
            - ชื่อ: ${originalGoal.goal_name}
            - ระยะเวลา (ปี): ${originalGoal.horizon}
            - จำนวนเงินเป้าหมาย: ${originalGoal.amount}
            แผนการลงทุนเดิม (สำหรับเป้าหมายนี้):
            - ${JSON.stringify(investmentPlan)}
            ตัวแปรใหม่ (What-If):
            - เงินออมต่อเดือน (ใหม่): ${newSavingsPerMonth} บาท
            
            จงตอบกลับเป็น JSON ที่สมบูรณ์แบบ (valid JSON) เฉพาะโครงสร้างนี้:
            {
              "probability_of_success_percent": 85,
              "analysis": "วิเคราะห์สั้นๆ (เช่น: 'ด้วยเงินออม ${newSavingsPerMonth} บาท/เดือน โอกาสสำเร็จเพิ่มขึ้นเป็น 85%...')"
            }
        `;
        const request = { contents: [{ role: 'user', parts: [{ text: resimulationPrompt }] }] };
        const result = await model.generateContent(request);
        const response = await result.response;
        const text = response.candidates[0].content.parts[0].text;
        const jsonResponse = JSON.parse(text);
        res.json(jsonResponse);
    } catch (error) {
        console.error('Error calling Gemini Resimulation API:', error);
        res.status(500).json({ error: 'Failed to resimulate goal' });
    }
});


// ❗️❗️❗️ [Endpoint 4: CHAT] ❗️❗️❗️
// (แก้ไข v20: แก้ไขบั๊ก Copy/Paste จาก v19)
app.post('/api/chat-with-plan', async (req, res) => {
    const { originalPlan, chatHistory, newMessage } = req.body;

    if (!originalPlan || !newMessage) {
        return res.status(400).json({ error: "Missing plan or new message" });
    }

    try {
        const model = vertex_ai.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
        });

        const systemPrompt = `คุณคือ AI Financial Planner ผู้ช่วย
        นี่คือแผนการเงิน (JSON) ที่คุณเพิ่งสร้างให้ผู้ใช้:
        ${JSON.stringify(originalPlan)}
        
        ตอนนี้, ภารกิจของคุณคือการตอบคำถาม "เพิ่มเติม" ของผู้ใช้เกี่ยวกับแผนนี้
        จงตอบแบบกระชับ, เป็นกันเอง, และอ้างอิงจากแผนที่คุณสร้าง`;

        const history = (chatHistory || []).map(turn => ({
            role: turn.role,
            parts: [{ text: turn.text }]
        }));

        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'model', parts: [{ text: "รับทราบครับ! ผมพร้อมตอบคำถามเกี่ยวกับแผนนี้แล้วครับ" }] },
                ...history
            ]
        });

        const result = await chat.sendMessage(newMessage);
        const response = await result.response;
        const aiText = response.candidates[0].content.parts[0].text;
        
        res.json({ reply: aiText });

    } catch (error) {
        console.error('Error calling Gemini Chat API:', error);
        res.status(500).json({ error: 'Failed to get chat reply from Gemini' });
    }
});


// ❗️❗️❗️ [แก้ไข v20] ❗️❗️❗️
// Serve index.html as the fallback for any non-API route
// (เปลี่ยนจาก '..' เป็นการชี้ไปที่ไฟล์ในโฟลเดอร์ปัจจุบัน)
app.get(/^\/.*/, (req, res) => { 
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});