from sqlmodel import create_engine, Session

sqlite_file_name = "slm_engine.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, echo=False, connect_args=connect_args)

def get_session():
    with Session(engine) as session:
        yield session
