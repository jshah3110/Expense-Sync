import os
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sqlalchemy.orm import Session
from db.database import Transaction

MODEL_PATH = "engine/classifier_model.pkl"

class TransactionClassifier:
    def __init__(self):
        self.pipeline = self._load_or_create_model()

    def _load_or_create_model(self):
        if os.path.exists(MODEL_PATH):
            with open(MODEL_PATH, 'rb') as f:
                return pickle.load(f)
        
        # Simple NLP pipeline: Text -> TF-IDF -> Naive Bayes
        return Pipeline([
            ('tfidf', TfidfVectorizer(stop_words='english')),
            ('clf', MultinomialNB()),
        ])

    def train(self, db: Session):
        """Train the model on all synced transactions."""
        # Fetch all transactions that have been manually assigned to a Splitwise group
        training_data = db.query(Transaction).filter(
            Transaction.is_synced == True,
            Transaction.splitwise_group_id != None
        ).all()
        
        if len(training_data) < 5:
            return False, "Not enough training data yet."

        # Features: Merchant Name + Category
        X = [f"{t.name} {t.category or ''}" for t in training_data]
        # Labels: The Splitwise Group ID
        y = [t.splitwise_group_id for t in training_data]

        self.pipeline.fit(X, y)
        self._save_model()
        return True, "Model trained successfully."

    def predict_group(self, transaction_name: str, category: str = ""):
        """Predict the Splitwise group for a new transaction."""
        # If the model hasn't been trained yet (no classes found), return None
        if not hasattr(self.pipeline.named_steps['clf'], 'classes_'):
            return None
            
        X_test = [f"{transaction_name} {category}"]
        prediction = self.pipeline.predict(X_test)
        
        # Get prediction probabilities to ensure confidence
        probas = self.pipeline.predict_proba(X_test)[0]
        max_proba = max(probas)
        
        if max_proba > 0.6: # 60% confidence threshold
            return prediction[0]
        return None

    def _save_model(self):
        with open(MODEL_PATH, 'wb') as f:
            pickle.dump(self.pipeline, f)

# Singleton instance
classifier = TransactionClassifier()
