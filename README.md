# React + FastAPI Dashboard

A full-stack dashboard application with a modern React frontend and FastAPI backend.

## Project Structure

```
dashboard_v3/
├── frontend/          # React + Vite application
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── backend/           # FastAPI application
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
└── README.md
```

## Prerequisites

- **Node.js** 18+ and npm (for frontend)
- **Python** 3.8+ (for backend)
- Git (optional)

## Getting Started

### 1. Frontend Setup

Navigate to the frontend directory and install dependencies:

```bash
cd frontend
npm install
```

Start the development server:

```bash
npm run dev
```

The React app will be available at `http://localhost:5173`

### 2. Backend Setup

Navigate to the backend directory and set up a Python virtual environment:

```bash
cd backend
python -m venv venv
```

Activate the virtual environment:

**Windows:**
```bash
venv\Scripts\activate
```

**Mac/Linux:**
```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the FastAPI server:

```bash
python main.py
```

or using uvicorn directly:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`
API documentation: `http://localhost:8000/docs`

## Running Both Services

For development, you'll want to run both servers simultaneously:

1. **Terminal 1** (Frontend):
```bash
cd frontend
npm run dev
```

2. **Terminal 2** (Backend):
```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
python main.py
```

The frontend is configured to proxy API requests to the backend via `/api/` endpoints.

## Available Scripts

### Frontend

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

### Backend

- `python main.py` - Run the development server
- `uvicorn main:app --reload` - Run with auto-reload

## API Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check
- `GET /data` - Sample data endpoint
- `GET /docs` - Interactive API documentation (Swagger UI)
- `GET /redoc` - Alternative API documentation (ReDoc)

## Environment Configuration

### Backend

Copy `.env.example` to `.env` and customize:

```bash
# In backend directory
cp .env.example .env
```

## Building for Production

### Frontend

```bash
cd frontend
npm run build
```

Output will be in `frontend/dist/`

### Backend

For production, use a production ASGI server like Gunicorn:

```bash
pip install gunicorn
gunicorn main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker
```

## Technology Stack

**Frontend:**
- React 18.2
- Vite 5.0
- Axios for API calls

**Backend:**
- FastAPI 0.109
- Uvicorn 0.27
- Python 3.8+

## Next Steps

1. Customize the dashboard layout and styling
2. Add more React components
3. Expand API endpoints as needed
4. Add authentication/authorization
5. Set up a database
6. Deploy to your hosting platform

## Support

For issues or questions, refer to:
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
